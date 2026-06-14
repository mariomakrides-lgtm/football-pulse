const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'public');
const KEYS = {
  footballData: process.env.FOOTBALL_DATA_TOKEN || '',
  sportsDb: process.env.THESPORTSDB_KEY || '',
  apiFootball: process.env.API_FOOTBALL_KEY || '',
  sportmonks: process.env.SPORTMONKS_TOKEN || ''
};
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};

function send(res, code, body, type='application/json; charset=utf-8') {
  res.writeHead(code, {'Content-Type': type, 'Cache-Control': 'no-store'});
  res.end(body);
}
function get(url, headers = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, {headers: {'User-Agent':'Mozilla/5.0 (compatible; FootballPulse/4.0)', 'Accept':'application/json,application/rss+xml,text/xml,*/*', ...headers}}, r => {
      if([301,302,303,307,308].includes(r.statusCode) && r.headers.location && redirects < 5){
        r.resume();
        const next=new URL(r.headers.location,url).toString();
        return resolve(get(next,headers,redirects+1));
      }
      let data='';
      r.on('data', c => data += c);
      r.on('end', () => resolve({status:r.statusCode, data, headers:r.headers}));
    }).on('error', reject);
  });
}
function parseRss(xml) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0,8);
  const clean = s => (s||'').replace(/<!\[CDATA\[|\]\]>/g,'').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
  const tag = (block, name) => { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i')); return m ? clean(m[1]) : ''; };
  return items.map(m => ({title:tag(m[1],'title'), link:tag(m[1],'link'), description:tag(m[1],'description'), pubDate:tag(m[1],'pubDate')}));
}
const isoDay = (offset=0) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
const statusMap = s => {
  const v=String(s||'').toUpperCase();
  if(['LIVE','IN PLAY','IN_PLAY','1H','2H','HT','ET','BT','P'].includes(v)) return v==='HT'?'PAUSED':'IN_PLAY';
  if(['FT','AET','PEN','FINISHED','MATCH FINISHED'].includes(v)) return 'FINISHED';
  if(['PST','POSTPONED'].includes(v)) return 'POSTPONED';
  if(['CANC','CANCELLED'].includes(v)) return 'CANCELLED';
  return 'TIMED';
};
const compCode = name => {
  const n=String(name||'').toLowerCase();
  if(n.includes('world cup')) return 'WC'; if(n.includes('champions league')) return 'CL'; if(n.includes('europa league')) return 'EL';
  if(n.includes('premier league')) return 'PL'; if(n.includes('la liga')||n.includes('primera division')) return 'PD'; if(n.includes('serie a')) return 'SA';
  if(n.includes('bundesliga')) return 'BL1'; if(n.includes('ligue 1')) return 'FL1'; if(n.includes('major league soccer')||n==='mls') return 'MLS';
  return String(name||'Football').replace(/[^A-Za-z]/g,'').slice(0,4).toUpperCase() || 'INT';
};
const cleanName = s => String(s||'TBC').replace(/\s+(FC|CF|AFC)$/i,'').trim();
const makeMatch = ({id,competition,date,status,minute,home,away,hs,as,source,sourceUrl}) => ({
  id:String(id), competition:{code:compCode(competition),name:competition||'Football'}, utcDate:date, status:statusMap(status), minute:minute||null,
  homeTeam:{name:cleanName(home)}, awayTeam:{name:cleanName(away)}, score:{fullTime:{home:hs??null,away:as??null}}, sources:[{name:source,url:sourceUrl}]
});

const demoMatches = [
  makeMatch({id:'demo-1',competition:'FIFA World Cup',date:new Date(Date.now()-25*60000).toISOString(),status:'IN_PLAY',minute:67,home:'Germany',away:'Curaçao',hs:2,as:0,source:'Demo feed',sourceUrl:'#'}),
  makeMatch({id:'demo-2',competition:'FIFA World Cup',date:new Date(Date.now()+75*60000).toISOString(),status:'TIMED',home:'Netherlands',away:'Japan',source:'Demo feed',sourceUrl:'#'}),
  makeMatch({id:'demo-3',competition:'UEFA Champions League',date:new Date(Date.now()-3*3600000).toISOString(),status:'FINISHED',home:'Paris Saint-Germain',away:'Arsenal',hs:2,as:1,source:'Demo feed',sourceUrl:'#'})
];

async function footballData(dateFrom,dateTo){
  if(!KEYS.footballData) return {name:'football-data.org',state:'not configured',matches:[]};
  const r=await get(`https://api.football-data.org/v4/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,{'X-Auth-Token':KEYS.footballData});
  if(r.status!==200) throw new Error(`HTTP ${r.status}`);
  const d=JSON.parse(r.data);
  return {name:'football-data.org',state:'online',matches:(d.matches||[]).map(m=>makeMatch({id:`fd-${m.id}`,competition:m.competition?.name,date:m.utcDate,status:m.status,minute:m.minute,home:m.homeTeam?.name,away:m.awayTeam?.name,hs:m.score?.fullTime?.home,as:m.score?.fullTime?.away,source:'football-data.org',sourceUrl:'https://www.football-data.org/'}))};
}
async function sportsDb(dateFrom,dateTo){
  if(!KEYS.sportsDb) return {name:'TheSportsDB',state:'not configured',matches:[]};
  const days=[]; for(let d=new Date(dateFrom+'T12:00:00Z'); d<=new Date(dateTo+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+1)) days.push(d.toISOString().slice(0,10));
  const responses=await Promise.all(days.map(day=>get(`https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(KEYS.sportsDb)}/eventsday.php?d=${day}&s=Soccer`)));
  const events=responses.flatMap(r=>{if(r.status!==200)return[];try{return JSON.parse(r.data).events||[]}catch{return[]}});
  return {name:'TheSportsDB',state:'online',matches:events.map(e=>makeMatch({id:`tsdb-${e.idEvent}`,competition:e.strLeague,date:e.strTimestamp||`${e.dateEvent}T${e.strTime||'00:00:00'}Z`,status:e.strStatus||e.strProgress,minute:parseInt(e.strProgress)||null,home:e.strHomeTeam,away:e.strAwayTeam,hs:e.intHomeScore===''?null:Number(e.intHomeScore),as:e.intAwayScore===''?null:Number(e.intAwayScore),source:'TheSportsDB',sourceUrl:'https://www.thesportsdb.com/'}))};
}
async function apiFootball(dateFrom,dateTo){
  if(!KEYS.apiFootball) return {name:'API-Football',state:'not configured',matches:[]};
  const days=[]; for(let d=new Date(dateFrom+'T12:00:00Z'); d<=new Date(dateTo+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+1)) days.push(d.toISOString().slice(0,10));
  const responses=await Promise.all(days.map(day=>get(`https://v3.football.api-sports.io/fixtures?date=${day}`,{'x-apisports-key':KEYS.apiFootball})));
  const fixtures=responses.flatMap(r=>{if(r.status!==200)return[];try{return JSON.parse(r.data).response||[]}catch{return[]}});
  return {name:'API-Football',state:'online',matches:fixtures.map(x=>makeMatch({id:`af-${x.fixture?.id}`,competition:x.league?.name,date:x.fixture?.date,status:x.fixture?.status?.short,minute:x.fixture?.status?.elapsed,home:x.teams?.home?.name,away:x.teams?.away?.name,hs:x.goals?.home,as:x.goals?.away,source:'API-Football',sourceUrl:'https://api-sports.io/'}))};
}
async function sportmonks(dateFrom,dateTo){
  if(!KEYS.sportmonks) return {name:'Sportmonks',state:'not configured',matches:[]};
  const r=await get(`https://api.sportmonks.com/v3/football/fixtures/between/${dateFrom}/${dateTo}?api_token=${encodeURIComponent(KEYS.sportmonks)}&include=participants;league;scores;state`);
  if(r.status!==200) throw new Error(`HTTP ${r.status}`);
  const d=JSON.parse(r.data);
  const matches=(d.data||[]).map(x=>{
    const parts=x.participants||[]; const home=parts.find(p=>p.meta?.location==='home')||parts[0]; const away=parts.find(p=>p.meta?.location==='away')||parts[1];
    const current=(x.scores||[]).find(s=>s.description==='CURRENT') || (x.scores||[]).at(-1); const score=current?.score?.goals;
    return makeMatch({id:`sm-${x.id}`,competition:x.league?.name,date:x.starting_at,status:x.state?.state||x.state?.short_name,minute:x.state?.minute,home:home?.name,away:away?.name,hs:score?.home,as:score?.away,source:'Sportmonks',sourceUrl:'https://www.sportmonks.com/'});
  });
  return {name:'Sportmonks',state:'online',matches};
}
function keyFor(m){return `${new Date(m.utcDate).toISOString().slice(0,16)}|${cleanName(m.homeTeam.name).toLowerCase()}|${cleanName(m.awayTeam.name).toLowerCase()}`}
function mergeMatches(providerResults){
  const map=new Map();
  providerResults.flatMap(x=>x.matches).forEach(m=>{
    const k=keyFor(m); const old=map.get(k);
    if(!old){map.set(k,m);return}
    old.sources=[...old.sources,...m.sources.filter(s=>!old.sources.some(o=>o.name===s.name))];
    const oldLive=['IN_PLAY','PAUSED'].includes(old.status), newLive=['IN_PLAY','PAUSED'].includes(m.status);
    if(newLive||(!oldLive&&m.status==='FINISHED')){old.status=m.status;old.minute=m.minute;old.score=m.score;}
  });
  return [...map.values()].sort((a,b)=>new Date(a.utcDate)-new Date(b.utcDate));
}

async function fotmobScores(dateFrom,dateTo){
  const days=[];
  for(let d=new Date(dateFrom+'T12:00:00Z'); d<=new Date(dateTo+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+1)) days.push(d.toISOString().slice(0,10).replaceAll('-',''));
  const responses=await Promise.all(days.map(day=>get(`https://www.fotmob.com/api/matches?date=${day}&timezone=Europe%2FLondon&ccode3=GBR`,{
    'User-Agent':'Mozilla/5.0 (compatible; FootballPulse/4.0)',
    'Referer':'https://www.fotmob.com/',
    'Origin':'https://www.fotmob.com'
  })));
  const matches=[];
  for(const r of responses){
    if(r.status!==200) continue;
    try{
      const d=JSON.parse(r.data);
      for(const league of (d.leagues||[])){
        for(const m of (league.matches||[])){
          const st=m.status||{};
          const date=st.utcTime||m.time||m.matchTimeUTC||m.utcTime;
          const rawStatus=st.finished?'FINISHED':st.started?(st.reason?.short||st.reason?.long||st.liveTime?.short||'IN_PLAY'):'TIMED';
          const minute=parseInt(st.liveTime?.short||st.liveTime?.long||st.reason?.short)||null;
          const homeScore=m.home?.score ?? m.homeTeam?.score ?? m.score?.home ?? null;
          const awayScore=m.away?.score ?? m.awayTeam?.score ?? m.score?.away ?? null;
          matches.push(makeMatch({
            id:`fm-${m.id||league.id+'-'+m.home?.name+'-'+m.away?.name+'-'+date}`,
            competition:league.name||league.parentLeagueName||'Football',
            date,status:rawStatus,minute,
            home:m.home?.name||m.homeTeam?.name,away:m.away?.name||m.awayTeam?.name,
            hs:homeScore,as:awayScore,source:'FotMob',
            sourceUrl:m.id?`https://www.fotmob.com/matches/${m.id}`:'https://www.fotmob.com/'
          }));
        }
      }
    }catch{}
  }
  if(!matches.length) throw new Error('No FotMob match data returned');
  return {name:'FotMob',state:'online',matches};
}

async function breakingNews(){
  const feeds=[
    {name:'BBC Sport',url:'https://feeds.bbci.co.uk/sport/football/rss.xml'},
    {name:'The Guardian',url:'https://www.theguardian.com/football/rss'},
    {name:'ESPN',url:'https://www.espn.com/espn/rss/soccer/news'}
  ];
  const settled=await Promise.allSettled(feeds.map(async f=>{
    const r=await get(f.url);
    if(r.status!==200) throw new Error(`HTTP ${r.status}`);
    return parseRss(r.data).map(x=>({...x,source:f.name}));
  }));
  const sourceStates=settled.map((r,i)=>({name:feeds[i].name,state:r.status==='fulfilled'?'online':'error'}));
  const items=settled.flatMap(r=>r.status==='fulfilled'?r.value:[]);
  const seen=new Set();
  const unique=items.filter(x=>{const k=(x.link||x.title).toLowerCase();if(seen.has(k))return false;seen.add(k);return true});
  unique.sort((a,b)=>(new Date(b.pubDate)||0)-(new Date(a.pubDate)||0));
  return {items:unique.slice(0,18),sources:sourceStates};
}

async function fotmobFixtures(dateFrom,dateTo){
  const days=[];
  for(let d=new Date(dateFrom+'T12:00:00Z'); d<=new Date(dateTo+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+1)) days.push(d.toISOString().slice(0,10).replaceAll('-',''));
  const responses=await Promise.all(days.map(day=>get(`https://www.fotmob.com/api/matches?date=${day}&timezone=Europe%2FLondon&ccode3=GBR`,{
    'User-Agent':'Mozilla/5.0 (compatible; FootballPulse/3.0)',
    'Referer':'https://www.fotmob.com/',
    'Origin':'https://www.fotmob.com'
  })));
  const fixtures=[];
  for(const r of responses){
    if(r.status!==200) continue;
    try{
      const d=JSON.parse(r.data);
      for(const league of (d.leagues||[])){
        for(const m of (league.matches||[])){
          const status=m.status||{};
          if(status.finished || status.started) continue;
          const date=m.status?.utcTime || m.time || m.matchTimeUTC || m.utcTime;
          fixtures.push({
            id:String(m.id||`${league.id}-${m.home?.name}-${m.away?.name}-${date}`),
            competition:league.name||league.parentLeagueName||'Football',
            country:league.ccode||league.country||'',
            utcDate:date,
            homeTeam:{name:cleanName(m.home?.name||m.homeTeam?.name)},
            awayTeam:{name:cleanName(m.away?.name||m.awayTeam?.name)},
            round:m.round||m.roundName||'',
            source:{name:'FotMob',url:m.id?`https://www.fotmob.com/matches/${m.id}`:'https://www.fotmob.com/'}
          });
        }
      }
    }catch{}
  }
  const seen=new Set();
  return fixtures.filter(f=>{const k=`${f.id}|${f.utcDate}`;if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>new Date(a.utcDate)-new Date(b.utcDate));
}

async function api(req,res){
  if(req.url.startsWith('/api/fotmob-fixtures')){
    const u=new URL(req.url,'http://localhost');
    const dateFrom=u.searchParams.get('dateFrom')||isoDay(0);
    const dateTo=u.searchParams.get('dateTo')||isoDay(7);
    try{
      const fixtures=await fotmobFixtures(dateFrom,dateTo);
      return send(res,200,JSON.stringify({source:'FotMob',unofficial:true,fixtures,message:'Upcoming fixture data loaded from FotMob web endpoints.'}));
    }catch(e){
      return send(res,200,JSON.stringify({source:'FotMob',unofficial:true,fixtures:[],error:e.message||'FotMob unavailable'}));
    }
  }
  if(req.url.startsWith('/api/news')){
    try{return send(res,200,JSON.stringify(await breakingNews()));}
    catch(e){return send(res,200,JSON.stringify({items:[],sources:[],error:e.message||'News unavailable'}));}
  }
  if(req.url.startsWith('/api/matches')){
    const u=new URL(req.url,'http://localhost'); const dateFrom=u.searchParams.get('dateFrom')||isoDay(-1); const dateTo=u.searchParams.get('dateTo')||isoDay(2);
    const jobs=[fotmobScores(dateFrom,dateTo),footballData(dateFrom,dateTo),sportsDb(dateFrom,dateTo),apiFootball(dateFrom,dateTo),sportmonks(dateFrom,dateTo)];
    const settled=await Promise.allSettled(jobs);
    const providers=settled.map((r,i)=>r.status==='fulfilled'?r.value:{name:['FotMob','football-data.org','TheSportsDB','API-Football','Sportmonks'][i],state:'error',matches:[],error:r.reason?.message||'Request failed'});
    const merged=mergeMatches(providers); const liveSources=providers.some(p=>p.state==='online');
    return send(res,200,JSON.stringify({demo:!liveSources||!merged.length,matches:merged.length?merged:demoMatches,providers:providers.map(({name,state,error,matches})=>({name,state,error,count:matches.length})),message:liveSources?'Real scores loaded and merged from available providers.':'Live providers are temporarily unavailable.'}));
  }
  send(res,404,JSON.stringify({error:'Not found'}));
}

http.createServer(async(req,res)=>{
  if(req.url.startsWith('/api/')) return api(req,res);
  const requestPath=decodeURIComponent(req.url.split('?')[0]); const file=path.join(ROOT,requestPath==='/'?'index.html':requestPath);
  if(!file.startsWith(ROOT))return send(res,403,'Forbidden','text/plain');
  fs.readFile(file,(err,data)=>{if(err)return send(res,404,'Not found','text/plain');res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(data);});
}).listen(PORT,()=>console.log(`Football Pulse running at http://localhost:${PORT}`));
