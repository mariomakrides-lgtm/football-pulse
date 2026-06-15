const grid=document.querySelector('#matchGrid'),filters=document.querySelector('#filters'),notice=document.querySelector('#notice'),providerBar=document.querySelector('#providerBar');
let allMatches=[],active='ALL';
const labels={WC:'World Cup',CL:'Champions League',EL:'Europa League',PL:'Premier League',PD:'La Liga',SA:'Serie A',BL1:'Bundesliga',FL1:'Ligue 1',MLS:'MLS'};
const escapeHtml=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const safeUrl=u=>/^https:\/\//i.test(u||'')?u:'#';
const isLive=m=>['IN_PLAY','PAUSED','LIVE'].includes(m.status);
const statusText=m=>isLive(m)?(m.status==='PAUSED'?'HT':`${m.minute||'LIVE'}′`):m.status==='FINISHED'?'FT':m.status==='POSTPONED'?'P-P':new Date(m.utcDate).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
function renderFilters(){const codes=['ALL',...new Set(allMatches.map(m=>m.competition?.code).filter(Boolean))];filters.innerHTML=codes.map(c=>`<button class="filter ${c===active?'active':''}" data-code="${c}">${c==='ALL'?'All matches':labels[c]||c}</button>`).join('');filters.querySelectorAll('button').forEach(b=>b.onclick=()=>{active=b.dataset.code;renderFilters();renderMatches()})}
function renderMatches(){const list=active==='ALL'?allMatches:allMatches.filter(m=>m.competition?.code===active);if(!list.length){grid.innerHTML='<div class="notice">No matches found for this competition in the current date range.</div>';return}grid.innerHTML=list.map(m=>{const live=isLive(m),final=m.status==='FINISHED',hs=m.score?.fullTime?.home,as=m.score?.fullTime?.away;const sources=(m.sources||[]).map(s=>`<a href="${safeUrl(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.name)}</a>`).join(' + ');return `<article class="match"><div class="match-top"><span>${escapeHtml(m.competition?.name||'Football')}</span><span class="status ${live?'live':final?'final':''}">${statusText(m)}</span></div><div class="team"><span class="team-name">${escapeHtml(m.homeTeam?.name||'TBC')}</span><span class="score">${hs??(final?0:'–')}</span></div><div class="team"><span class="team-name">${escapeHtml(m.awayTeam?.name||'TBC')}</span><span class="score">${as??(final?0:'–')}</span></div><div class="match-foot">${new Date(m.utcDate).toLocaleDateString([],{weekday:'short',day:'numeric',month:'short'})} · ${live?'Match in progress':final?'Full time':'Scheduled fixture'}<div class="match-sources">Sources: ${sources||'Unknown'}</div></div></article>`}).join('');document.querySelector('#liveCount').textContent=list.filter(isLive).length}
function renderProviders(providers=[]){providerBar.innerHTML=providers.map(p=>`<span class="provider ${p.state==='online'?'online':p.state==='error'?'error':''}"><i></i>${escapeHtml(p.name)} <b>${p.state==='online'?`${p.count} matches`:p.state}</b></span>`).join('')}
async function loadMatches(){document.querySelector('#refreshBtn').textContent='↻ Updating…';try{const r=await fetch('/api/matches');const data=await r.json();allMatches=data.matches||[];notice.classList.toggle('hidden',!data.demo);notice.textContent=data.demo?'Demonstration scores are showing. Add at least one provider key to the server for genuine live updates.':'';renderProviders(data.providers);renderFilters();renderMatches();document.querySelector('#updatedAt').textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}catch(e){grid.innerHTML='<div class="notice">Scores could not be loaded. Check the server connection.</div>'}document.querySelector('#refreshBtn').textContent='↻ Refresh now'}
const newsClass=s=>String(s||'News').toLowerCase().replace(/[^a-z]+/g,'-');
const timeAgo=d=>{const ms=Date.now()-new Date(d).getTime();if(!Number.isFinite(ms))return 'Just in';const m=Math.max(0,Math.floor(ms/60000));if(m<1)return 'Just now';if(m<60)return `${m} min ago`;const h=Math.floor(m/60);if(h<24)return `${h}h ago`;return `${Math.floor(h/24)}d ago`};
async function loadNews(){const el=document.querySelector('#newsGrid'),sourcesEl=document.querySelector('#newsSources');try{const r=await fetch('/api/news');const d=await r.json();if(!d.items?.length)throw new Error();sourcesEl.innerHTML=(d.sources||[]).map(s=>`<span class="news-source ${s.state==='online'?'online':'error'}"><i></i>${escapeHtml(s.name)}</span>`).join('');el.innerHTML=d.items.slice(0,9).map((x,i)=>{const fresh=Date.now()-new Date(x.pubDate).getTime()<2*3600000;return `<a class="news-card ${i===0?'lead-news':''}" target="_blank" rel="noopener" href="${safeUrl(x.link)}"><div class="news-topline"><span class="publisher ${newsClass(x.source)}">${escapeHtml(x.source||'Football News')}</span>${fresh?'<span class="breaking-tag">BREAKING</span>':''}</div><h3>${escapeHtml(x.title)}</h3><p>${escapeHtml(x.description).slice(0,180)}${x.description?.length>180?'…':''}</p><time>${timeAgo(x.pubDate)} · ${new Date(x.pubDate).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></a>`}).join('');document.querySelector('#tickerTrack').textContent=[...d.items,...d.items].map(x=>`⚡ ${x.source}: ${x.title}`).join('     •     ')}catch(e){sourcesEl.innerHTML='';el.innerHTML='<div class="notice">Breaking football news is temporarily unavailable.</div>'}}
document.querySelector('#refreshBtn').onclick=loadMatches;loadMatches();loadNews();setInterval(loadMatches,60000);setInterval(loadNews,180000);

// Modern interaction layer
const revealObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
  if(entry.isIntersecting){entry.target.classList.add('visible');revealObserver.unobserve(entry.target)}
}),{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>revealObserver.observe(el));

const glow=document.querySelector('#cursorGlow');
window.addEventListener('pointermove',e=>{
  if(glow){glow.style.left=`${e.clientX}px`;glow.style.top=`${e.clientY}px`}
});

const tilt=document.querySelector('.tilt-card');
if(tilt){
  tilt.addEventListener('pointermove',e=>{
    const r=tilt.getBoundingClientRect();
    const x=(e.clientX-r.left)/r.width-.5;
    const y=(e.clientY-r.top)/r.height-.5;
    tilt.style.transform=`rotateY(${x*8}deg) rotateX(${-y*8}deg)`;
  });
  tilt.addEventListener('pointerleave',()=>tilt.style.transform='rotateY(0) rotateX(0)');
}

document.addEventListener('pointermove',e=>{
  const card=e.target.closest('.match');
  if(!card)return;
  const r=card.getBoundingClientRect();
  card.style.setProperty('--mx',`${e.clientX-r.left}px`);
  card.style.setProperty('--my',`${e.clientY-r.top}px`);
});const liveModal = document.getElementById("liveMatchModal");
const liveModalContent = document.getElementById("liveMatchContent");
const liveModalClose = document.getElementById("liveModalClose");
const liveModalBackdrop = document.getElementById("liveModalBackdrop");

let liveDetailsTimer = null;
let activeMatchId = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function numericValue(value) {
  if (typeof value === "number") return value;

  const number = Number.parseFloat(String(value || "").replace("%", ""));
  return Number.isFinite(number) ? number : 0;
}

function statWidth(home, away) {
  const homeValue = numericValue(home);
  const awayValue = numericValue(away);
  const total = homeValue + awayValue;

  if (!total) return 50;
  return Math.round((homeValue / total) * 100);
}

function eventIcon(event) {
  const detail = `${event.type} ${event.detail}`.toLowerCase();

  if (detail.includes("goal")) return "⚽";
  if (detail.includes("yellow")) return "🟨";
  if (detail.includes("red")) return "🟥";
  if (detail.includes("subst")) return "🔄";
  if (detail.includes("var")) return "📺";

  return "•";
}

function renderLiveDetails(data) {
  if (!data.fixture) {
    liveModalContent.innerHTML = `
      <div class="live-error">
        Match information is not available yet.
      </div>
    `;
    return;
  }

  const fixture = data.fixture;

  const statisticsHtml = data.statistics
    .map(stat => {
      const width = statWidth(stat.home, stat.away);

      return `
        <div class="live-stat">
          <div class="live-stat__values">
            <strong>${escapeHtml(stat.home)}</strong>
            <span>${escapeHtml(stat.name)}</span>
            <strong>${escapeHtml(stat.away)}</strong>
          </div>

          <div class="live-stat__bar">
            <span style="width:${width}%"></span>
          </div>
        </div>
      `;
    })
    .join("");

  const eventsHtml = data.events.length
    ? data.events
        .slice()
        .reverse()
        .map(event => {
          const minute = event.minute
            ? `${event.minute}${event.extraMinute ? `+${event.extraMinute}` : ""}'`
            : "";

          return `
            <div class="timeline-event">
              <span class="timeline-event__minute">
                ${escapeHtml(minute)}
              </span>

              <span class="timeline-event__icon">
                ${eventIcon(event)}
              </span>

              <div>
                <strong>${escapeHtml(event.player || event.team)}</strong>
                <p>
                  ${escapeHtml(event.detail || event.type)}
                  ${event.assist ? ` · Assist: ${escapeHtml(event.assist)}` : ""}
                </p>
              </div>
            </div>
          `;
        })
        .join("")
    : `<p class="live-empty">No match events have been reported yet.</p>`;

  liveModalContent.innerHTML = `
    <div class="live-scoreboard">
      <div class="live-team">
        ${
          fixture.homeLogo
            ? `<img src="${escapeHtml(fixture.homeLogo)}" alt="">`
            : ""
        }
        <span>${escapeHtml(fixture.home)}</span>
      </div>

      <div class="live-scoreboard__centre">
        <span class="live-minute">
          ${escapeHtml(fixture.minute ? `${fixture.minute}'` : fixture.status)}
        </span>

        <strong>
          ${escapeHtml(fixture.homeScore ?? 0)}
          <span>–</span>
          ${escapeHtml(fixture.awayScore ?? 0)}
        </strong>
      </div>

      <div class="live-team">
        ${
          fixture.awayLogo
            ? `<img src="${escapeHtml(fixture.awayLogo)}" alt="">`
            : ""
        }
        <span>${escapeHtml(fixture.away)}</span>
      </div>
    </div>

    <div class="live-meta">
      ${fixture.venue ? `<span>📍 ${escapeHtml(fixture.venue)}</span>` : ""}
      ${fixture.referee ? `<span>Referee: ${escapeHtml(fixture.referee)}</span>` : ""}
      <span>Updated ${new Date(data.updatedAt).toLocaleTimeString()}</span>
    </div>

    <div class="live-tabs">
      <section>
        <h3>Live statistics</h3>
        <div class="live-statistics">
          ${statisticsHtml}
        </div>
      </section>

      <section>
        <h3>Match events</h3>
        <div class="live-timeline">
          ${eventsHtml}
        </div>
      </section>
    </div>
  `;
}

async function loadLiveDetails(matchId) {
  try {
    const response = await fetch(
      `/api/match-details?id=${encodeURIComponent(matchId)}`,
      {
        cache: "no-store"
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Live statistics could not be loaded.");
    }

    renderLiveDetails(data);
  } catch (error) {
    liveModalContent.innerHTML = `
      <div class="live-error">
        ${escapeHtml(error.message)}
      </div>
    `;
  }
}

function openLiveMatch(matchId) {
  if (!matchId.startsWith("af-")) {
    alert("Detailed live statistics are not available from this match provider.");
    return;
  }

  activeMatchId = matchId;
  liveModal.hidden = false;
  document.body.classList.add("modal-open");

  liveModalContent.innerHTML = `
    <div class="live-loading">Loading live statistics…</div>
  `;

  loadLiveDetails(activeMatchId);

  clearInterval(liveDetailsTimer);

  liveDetailsTimer = setInterval(() => {
    if (activeMatchId) {
      loadLiveDetails(activeMatchId);
    }
  }, 15000);
}

function closeLiveMatch() {
  activeMatchId = null;
  clearInterval(liveDetailsTimer);
  liveDetailsTimer = null;

  liveModal.hidden = true;
  document.body.classList.remove("modal-open");
}

document.addEventListener("click", event => {
  const card = event.target.closest("[data-live-match]");

  if (!card) return;

  openLiveMatch(card.dataset.matchId);
});

liveModalClose?.addEventListener("click", closeLiveMatch);
liveModalBackdrop?.addEventListener("click", closeLiveMatch);

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !liveModal.hidden) {
    closeLiveMatch();
  }
});

const originalRenderMatches=renderMatches;
renderMatches=function(){
  originalRenderMatches();
  document.querySelectorAll('.match').forEach((card,i)=>card.style.animationDelay=`${Math.min(i,12)*45}ms`);
};

const originalLoadMatches=loadMatches;
loadMatches=async function(){
  const btn=document.querySelector('#refreshBtn');
  btn?.classList.add('is-loading');
  await originalLoadMatches();
  btn?.classList.remove('is-loading');
};


// Upcoming fixtures powered by FotMob
let allFixtures=[], activeFixtureDay='all';
const dayKey=d=>new Date(d).toLocaleDateString('en-CA',{timeZone:'Europe/London'});
const prettyDay=d=>{const x=new Date(`${d}T12:00:00`),today=new Date();const t=today.toLocaleDateString('en-CA');const tomorrow=new Date(today.getTime()+86400000).toLocaleDateString('en-CA');if(d===t)return 'Today';if(d===tomorrow)return 'Tomorrow';return x.toLocaleDateString([],{weekday:'short',day:'numeric',month:'short'})};
function countdown(utc){const ms=new Date(utc)-Date.now();if(ms<=0)return 'Starting soon';const mins=Math.floor(ms/60000);if(mins<60)return `In ${mins} min`;const hrs=Math.floor(mins/60);if(hrs<24)return `In ${hrs}h ${mins%60}m`;const days=Math.floor(hrs/24);return `In ${days} day${days===1?'':'s'}`};
function renderFixtureDates(){const dates=[...new Set(allFixtures.map(f=>dayKey(f.utcDate)))].slice(0,8);const choices=['all',...dates];document.querySelector('#fixtureDates').innerHTML=choices.map(d=>`<button class="fixture-date ${d===activeFixtureDay?'active':''}" data-day="${d}"><small>${d==='all'?'NEXT':prettyDay(d).split(' ')[0]}</small><b>${d==='all'?'All fixtures':prettyDay(d).replace(/^\w+\s?/,'')}</b></button>`).join('');document.querySelectorAll('.fixture-date').forEach(b=>b.onclick=()=>{activeFixtureDay=b.dataset.day;renderFixtureDates();renderFixtures()})}
function renderFixtures(){const grid=document.querySelector('#fixtureGrid');const list=activeFixtureDay==='all'?allFixtures:allFixtures.filter(f=>dayKey(f.utcDate)===activeFixtureDay);if(!list.length){grid.innerHTML='<div class="notice">No upcoming FotMob fixtures were found for this date.</div>';return}const groups=new Map();list.forEach(f=>{const k=f.competition||'Football';if(!groups.has(k))groups.set(k,[]);groups.get(k).push(f)});grid.innerHTML=[...groups].map(([competition,items],gi)=>`<section class="fixture-league" style="--delay:${gi*55}ms"><div class="fixture-league-head"><div><span class="league-orb"></span><b>${escapeHtml(competition)}</b></div><small>${items.length} MATCH${items.length===1?'':'ES'}</small></div>${items.map((f,i)=>`<a class="fixture-row" href="${safeUrl(f.source?.url)}" target="_blank" rel="noopener" style="--row-delay:${i*35}ms"><div class="fixture-time"><b>${new Date(f.utcDate).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'})}</b><small>${countdown(f.utcDate)}</small></div><div class="fixture-teams"><span>${escapeHtml(f.homeTeam?.name||'TBC')}</span><i>vs</i><span>${escapeHtml(f.awayTeam?.name||'TBC')}</span></div><div class="fixture-meta"><span>${escapeHtml(f.round||prettyDay(dayKey(f.utcDate)))}</span><strong>F</strong></div></a>`).join('')}</section>`).join('')}
async function loadFixtures(){const notice=document.querySelector('#fixtureNotice');try{const from=new Date().toISOString().slice(0,10);const to=new Date(Date.now()+8*86400000).toISOString().slice(0,10);const r=await fetch(`/api/fotmob-fixtures?dateFrom=${from}&dateTo=${to}`);const d=await r.json();allFixtures=(d.fixtures||[]).filter(f=>f.utcDate);notice.classList.toggle('hidden',!d.error);notice.textContent=d.error?'FotMob fixtures are temporarily unavailable. The rest of the site will continue working.':'';renderFixtureDates();renderFixtures()}catch(e){notice.classList.remove('hidden');notice.textContent='FotMob fixtures could not be loaded right now.';document.querySelector('#fixtureGrid').innerHTML=''}}
loadFixtures();setInterval(loadFixtures,300000);setInterval(()=>{if(allFixtures.length)renderFixtures()},60000);
