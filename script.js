(() => {
  const STORAGE_KEY = 'shandoku-wife-edition-save-v1';
  const THEME_KEY = 'shandoku-wife-edition-theme-v1';
  const GRID_SIZE = 9;
  const TOTAL_CELLS = GRID_SIZE * GRID_SIZE;
  const HISTORY_LIMIT = 200;
  const RIFT_COOLDOWN_MS = 12000;
  const RIFT_STATUS_DELAY_MS = 950;
  const RIFT_STATUS_DELAY_REDUCED_MOTION_MS = 500;
  const RIFT_EVALUATE_DEBOUNCE_MS = 140;
  const RIFT_NON_CONFLICT_CHECK_INTERVAL = 5;
  const TEST_MODE = ['localhost','127.0.0.1'].includes(window.location.hostname)
    || new URLSearchParams(window.location.search).get('testHooks') === '1';

  const boardEl = document.getElementById('board');
  const statusEl = document.getElementById('status');
  const difficultyEl = document.getElementById('difficulty');
  const timeStat = document.getElementById('timeStat');
  const errorStat = document.getElementById('errorStat');
  const progressBar = document.getElementById('progressBar');
  const notesModeBtn = document.getElementById('notesModeBtn');
  const autoNotesBtn = document.getElementById('autoNotesBtn');
  const themeBtn = document.getElementById('themeBtn');
  const boardShellEl = document.querySelector('.board-shell');
  const riftModal = document.getElementById('riftModal');
  const riftTitleEl = document.getElementById('riftTitle');
  const riftBodyEl = document.getElementById('riftBody');
  const riftBackdrop = document.getElementById('riftBackdrop');
  const riftReturnBtn = document.getElementById('riftReturnBtn');
  const riftRestoreBtn = document.getElementById('riftRestoreBtn');
  const riftFreshBtn = document.getElementById('riftFreshBtn');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let selected = null;
  let notesMode = false;
  let autoCleanup = true;
  let elapsed = 0;
  let timerId = null;
  let history = [];
  let future = [];
  let touchStart = null;

  let startingGrid = null;
  let grid = null;
  let notes = null;
  let lastSolvableSnapshot = null;
  let boardWasSolvable = true;
  let statusSequenceId = 0;
  let interactionLocked = false;
  let riftEvalTimer = null;
  let movesSinceSolvabilityCheck = 0;
  let riftState = {
    active:false,
    nodes:[],
    hasTriggered:false,
    cooldownUntil:0,
    copyKey:'pattern'
  };
  let riftSequenceRunning = false;
  let lastFocusedBeforeRiftModal = null;
  const riftExtensionHooks = {
    onTrigger:[],
    onResolve:[]
  };
  const riftCopySets = {
    pattern:{
      title:'A seam in the pattern',
      lines:['This puzzle cannot exist.','Looking for a way through…','Something opened.'],
      fragment:'Not every wrong turn is failure. Some of them are doors.'
    },
    geometry:{
      title:'The shape bent',
      lines:['The grid lost coherence.','Re-threading the path…','A fracture node remains.'],
      fragment:'You pushed the puzzle past logic, and it answered.'
    },
    lantern:{
      title:'Between answers',
      lines:['The pattern broke cleanly.','Listening for a softer route…','A quiet door is available.'],
      fragment:'Some detours are where the gift is waiting.'
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────

  function cloneGrid(g){ return g.map(row => row.slice()); }
  function cloneNotes(src){ return src.map(row => row.map(s => new Set([...s]))); }

  function vibrate(ms){ if(navigator.vibrate) navigator.vibrate(ms); }

  // Returns candidates for a given board state (does not use global grid)
  function candidatesForBoard(board, r, c){
    if(board[r][c] !== 0) return [];
    const used = new Set();
    for(let i=0;i<GRID_SIZE;i++){
      if(board[r][i]) used.add(board[r][i]);
      if(board[i][c]) used.add(board[i][c]);
    }
    const br = Math.floor(r/3)*3, bc = Math.floor(c/3)*3;
    for(let rr=br;rr<br+3;rr++) for(let cc=bc;cc<bc+3;cc++) if(board[rr][cc]) used.add(board[rr][cc]);
    const out = [];
    for(let n=1;n<=GRID_SIZE;n++) if(!used.has(n)) out.push(n);
    return out;
  }

  // Candidates for current global grid
  function candidatesFor(r, c){ return candidatesForBoard(grid, r, c); }

  function countFilled(){
    let n = 0;
    for(let r=0;r<GRID_SIZE;r++) for(let c=0;c<GRID_SIZE;c++) if(grid[r][c]) n++;
    return n;
  }

  function hasConflict(r, c){
    const v = grid[r][c];
    if(!v) return false;
    for(let i=0;i<GRID_SIZE;i++) if(i!==c && grid[r][i]===v) return true;
    for(let i=0;i<GRID_SIZE;i++) if(i!==r && grid[i][c]===v) return true;
    const br=Math.floor(r/3)*3, bc=Math.floor(c/3)*3;
    for(let rr=br;rr<br+3;rr++) for(let cc=bc;cc<bc+3;cc++) if((rr!==r||cc!==c)&&grid[rr][cc]===v) return true;
    return false;
  }

  function countErrors(){
    let n=0;
    for(let r=0;r<GRID_SIZE;r++) for(let c=0;c<GRID_SIZE;c++) if(hasConflict(r,c)) n++;
    return n;
  }

  function isSolved(){ return countFilled()===TOTAL_CELLS && countErrors()===0; }

  function hasImmediateContradiction(board){
    function hasDuplicate(values){
      const seen=new Set();
      for(const v of values){
        if(!v) continue;
        if(seen.has(v)) return true;
        seen.add(v);
      }
      return false;
    }
    for(let r=0;r<GRID_SIZE;r++) if(hasDuplicate(board[r])) return true;
    for(let c=0;c<GRID_SIZE;c++){
      const column=Array.from({length:GRID_SIZE},(_,r)=>board[r][c]);
      if(hasDuplicate(column)) return true;
    }
    for(let br=0;br<GRID_SIZE;br+=3){
      for(let bc=0;bc<GRID_SIZE;bc+=3){
        const block=[];
        for(let r=br;r<br+3;r++){
          for(let c=bc;c<bc+3;c++){
            block.push(board[r][c]);
          }
        }
        if(hasDuplicate(block)) return true;
      }
    }
    return false;
  }

  function hasAnySolution(board){
    if(hasImmediateContradiction(board)) return false;
    const b=cloneGrid(board);
    function search(){
      let best=null;
      for(let r=0;r<GRID_SIZE;r++){
        for(let c=0;c<GRID_SIZE;c++){
          if(b[r][c]===0){
            const cand=candidatesForBoard(b,r,c);
            if(cand.length===0) return false;
            if(!best||cand.length<best.cand.length) best={r,c,cand};
          }
        }
      }
      if(!best) return true;
      for(const n of best.cand){
        b[best.r][best.c]=n;
        if(search()) return true;
        b[best.r][best.c]=0;
      }
      return false;
    }
    return search();
  }

  function isRelated(r, c){
    if(!selected || (selected.r===r && selected.c===c)) return false;
    return selected.r===r || selected.c===c ||
      (Math.floor(selected.r/3)===Math.floor(r/3) && Math.floor(selected.c/3)===Math.floor(c/3));
  }

  function getPersistedElapsedTime(data){
    return data?.elapsed ?? data?.timeElapsed ?? data?.timer ?? data?.timeSeconds;
  }

  function normalizeElapsed(value){
    const parsed=Number(value);
    if(!Number.isFinite(parsed) || parsed<0) return 0;
    return Math.floor(parsed);
  }

  function formatTime(t){
    const normalized=normalizeElapsed(t);
    return `${String(Math.floor(normalized/60)).padStart(2,'0')}:${String(normalized%60).padStart(2,'0')}`;
  }

  // ── Notes ────────────────────────────────────────────────────────────────

  function fillNotesAll(){
    for(let r=0;r<GRID_SIZE;r++)
      for(let c=0;c<GRID_SIZE;c++)
        if(grid[r][c]===0) notes[r][c]=new Set(candidatesFor(r,c));
        else notes[r][c].clear();
  }

  function autoCleanNotesAround(r, c, value){
    if(!autoCleanup || !value) return;
    for(let i=0;i<GRID_SIZE;i++){
      if(i!==c) notes[r][i].delete(value);
      if(i!==r) notes[i][c].delete(value);
    }
    const br=Math.floor(r/3)*3, bc=Math.floor(c/3)*3;
    for(let rr=br;rr<br+3;rr++) for(let cc=bc;cc<bc+3;cc++) if(rr!==r||cc!==c) notes[rr][cc].delete(value);
    notes[r][c].clear();
  }

  // ── History ───────────────────────────────────────────────────────────────

  function pushHistory(){
    history.push({
      grid:cloneGrid(grid), notes:cloneNotes(notes),
      selected:selected?{...selected}:null,
      elapsed, notesMode, autoCleanup
    });
    if(history.length>HISTORY_LIMIT) history.shift();
    future=[];
  }

  function restoreSnapshot(snap){
    grid=cloneGrid(snap.grid); notes=cloneNotes(snap.notes);
    selected=snap.selected?{...snap.selected}:null;
    elapsed=snap.elapsed; notesMode=snap.notesMode; autoCleanup=snap.autoCleanup;
    boardShellEl.classList.remove('victory-glow');
    clearRiftVisualState();
    render(); updateStats(); updateToggles(); saveGame();
    captureLastSolvableSnapshot();
  }

  function undo(){
    if(!history.length){ setStatus('Nothing to undo.'); return; }
    future.push({grid:cloneGrid(grid),notes:cloneNotes(notes),selected:selected?{...selected}:null,elapsed,notesMode,autoCleanup});
    restoreSnapshot(history.pop());
    setStatus('Undid last move.');
  }

  function redo(){
    if(!future.length){ setStatus('Nothing to redo.'); return; }
    history.push({grid:cloneGrid(grid),notes:cloneNotes(notes),selected:selected?{...selected}:null,elapsed,notesMode,autoCleanup});
    restoreSnapshot(future.pop());
    setStatus('Redid move.');
  }

  // ── UI updates ────────────────────────────────────────────────────────────

  const MIN_SPLASH_MS=800;
  const splashShownAt=Date.now();
  function hideSplash(){
    const splash=document.getElementById('splash');
    if(!splash) return;
    const elapsed=Date.now()-splashShownAt;
    const delay=Math.max(0,MIN_SPLASH_MS-elapsed);
    setTimeout(()=>{
      splash.classList.add('fade-out');
      splash.addEventListener('transitionend',()=>splash.remove(),{once:true});
    },delay);
  }

  function setStatus(msg){ statusEl.textContent=msg; }

  function notifyRiftHook(name, payload){
    const handlers = riftExtensionHooks[name] || [];
    handlers.forEach(handler => {
      try {
        handler(payload);
      } catch (error) {
        console.error(`Rift extension hook "${name}" failed:`, error);
      }
    });
  }

  function setInteractionLocked(locked){
    interactionLocked=locked;
    boardShellEl.classList.toggle('rift-locked',locked);
  }

  function canInteractWithBoard(options={}){
    if(interactionLocked) return false;
    if(riftState.active){
      if(options.showStatus!==false) setStatus('Resolve the rift first.');
      return false;
    }
    return true;
  }

  function snapshotCurrentState(){
    return {
      grid:cloneGrid(grid),
      notes:cloneNotes(notes),
      selected:selected?{...selected}:null,
      elapsed, notesMode, autoCleanup
    };
  }

  function captureLastSolvableSnapshot(){
    if(hasAnySolution(grid)){
      lastSolvableSnapshot=snapshotCurrentState();
      boardWasSolvable=true;
      return true;
    }
    boardWasSolvable=false;
    return false;
  }

  function markCurrentStateAsSolvable(){
    lastSolvableSnapshot=snapshotCurrentState();
    boardWasSolvable=true;
  }

  function serializeRiftState(){
    return {
      active:riftState.active,
      nodes:riftState.nodes.slice(0,3),
      hasTriggered:riftState.hasTriggered,
      cooldownUntil:riftState.cooldownUntil,
      copyKey:riftState.copyKey
    };
  }

  function deserializeRiftState(savedRiftState={}){
    const isRiftActive = !!savedRiftState.active;
    return {
      active:isRiftActive,
      nodes:isRiftActive ? (savedRiftState.nodes||[]).slice(0,3) : [],
      hasTriggered:!!savedRiftState.hasTriggered,
      cooldownUntil:Number(savedRiftState.cooldownUntil)||0,
      copyKey:savedRiftState.copyKey||'pattern'
    };
  }

  function resetRiftState(){
    riftState = { active:false, nodes:[], hasTriggered:false, cooldownUntil:0, copyKey:'pattern' };
    riftSequenceRunning = false;
  }

  function applyPostMovePipeline({ origin='player-move', riftOptions={}, shouldEvaluateRift=true, shouldCaptureSolvable=false }={}){
    render();
    saveGame();
    if(shouldCaptureSolvable) captureLastSolvableSnapshot();
    if(shouldEvaluateRift) scheduleRiftEvaluation(origin, riftOptions);
  }

  function clearRiftVisualState(){
    statusSequenceId++;
    if(riftEvalTimer){ clearTimeout(riftEvalTimer); riftEvalTimer=null; }
    riftState.active=false;
    riftSequenceRunning=false;
    riftState.nodes=[];
    movesSinceSolvabilityCheck=0;
    boardShellEl.classList.remove('rift-active','rift-glitch');
    statusEl.classList.remove('rift-status');
    riftModal.hidden=true;
    setInteractionLocked(false);
  }

  function getRiftNodes(){
    const conflicted=[];
    for(let r=0;r<GRID_SIZE;r++){
      for(let c=0;c<GRID_SIZE;c++){
        if(hasConflict(r,c)) conflicted.push({r,c});
      }
    }
    if(conflicted.length) return conflicted.slice(0,3);
    for(let r=0;r<GRID_SIZE;r++){
      for(let c=0;c<GRID_SIZE;c++){
        if(grid[r][c]===0) return [{r,c}];
      }
    }
    return [{r:4,c:4}];
  }

  async function runStatusSequence(lines){
    const id=++statusSequenceId;
    const fast=reducedMotion.matches;
    for(const line of lines){
      if(id!==statusSequenceId) return false;
      setStatus(line);
      await new Promise(resolve=>setTimeout(resolve,fast?RIFT_STATUS_DELAY_REDUCED_MOTION_MS:RIFT_STATUS_DELAY_MS));
    }
    return id===statusSequenceId;
  }

  function openRiftModal(){
    const copy=riftCopySets[riftState.copyKey]||riftCopySets.pattern;
    riftBodyEl.textContent=copy.fragment;
    riftTitleEl.textContent=copy.title;
    lastFocusedBeforeRiftModal = document.activeElement;
    riftModal.hidden=false;
    riftReturnBtn.focus();
  }

  async function triggerRiftEvent(){
    if(riftState.active || riftSequenceRunning) return;
    riftSequenceRunning=true;
    riftState.hasTriggered=true;
    riftState.cooldownUntil=Date.now()+RIFT_COOLDOWN_MS;
    setInteractionLocked(true);
    boardShellEl.classList.add('rift-active');
    if(!reducedMotion.matches) boardShellEl.classList.add('rift-glitch');
    statusEl.classList.add('rift-status');
    vibrate([15,55,15]);
    render();
    const copy=riftCopySets[riftState.copyKey]||riftCopySets.pattern;
    const complete=await runStatusSequence(copy.lines);
    boardShellEl.classList.remove('rift-glitch');
    if(!complete){
      riftSequenceRunning=false;
      return;
    }
    riftState.nodes=getRiftNodes();
    riftState.active=true;
    riftSequenceRunning=false;
    setInteractionLocked(false);
    render();
    setStatus('Rift node found. Tap the marked cell.');
    saveGame();
    notifyRiftHook('onTrigger', { rift:serializeRiftState(), snapshot:snapshotCurrentState() });
  }

  function shouldEvaluateRift(origin='system', options={}){
    if(origin!=='player-move') return false;
    if(riftState.active||riftSequenceRunning) return false;
    if(riftState.hasTriggered) return false;
    if(Date.now()<riftState.cooldownUntil) return false;
    // Explicit policy: evaluate immediately after conflict-introducing moves,
    // otherwise only every N non-conflicting moves to reduce solver pressure.
    if(!options.force){
      if(options.conflictIntroduced){
        movesSinceSolvabilityCheck=0;
      } else {
        movesSinceSolvabilityCheck++;
        if(movesSinceSolvabilityCheck<RIFT_NON_CONFLICT_CHECK_INTERVAL) return false;
        movesSinceSolvabilityCheck=0;
      }
    }
    return true;
  }

  function shouldTriggerRiftFromSolvability(solvable){
    if(solvable){
      markCurrentStateAsSolvable();
      return false;
    }
    return boardWasSolvable;
  }

  function evaluateRiftTrigger(origin='system', options={}){
    if(!shouldEvaluateRift(origin, options)) return;
    const solvable=hasAnySolution(grid);
    if(shouldTriggerRiftFromSolvability(solvable)){
      boardWasSolvable=false;
      triggerRiftEvent();
    }
  }

  function scheduleRiftEvaluation(origin='player-move', options={}){
    if(riftEvalTimer) clearTimeout(riftEvalTimer);
    riftEvalTimer=setTimeout(()=>{
      riftEvalTimer=null;
      evaluateRiftTrigger(origin, options);
    },RIFT_EVALUATE_DEBOUNCE_MS);
  }

  function restoreRiftStateFromSave(data){
    riftState=deserializeRiftState(data.riftState||{});
    riftSequenceRunning=false;
    if(riftState.active){
      boardShellEl.classList.add('rift-active');
      statusEl.classList.add('rift-status');
    }
  }

  function updateStats(){
    timeStat.textContent=formatTime(elapsed);
    const errs=countErrors();
    if(errs>0){
      errorStat.textContent=`${errs} err`;
      errorStat.hidden=false;
    } else {
      errorStat.hidden=true;
    }
    progressBar.style.width=`${Math.round(countFilled()/81*100)}%`;
  }

  function updateToggles(){
    notesModeBtn.textContent=notesMode?'Notes On':'Notes Off';
    notesModeBtn.classList.toggle('active',notesMode);
    autoNotesBtn.textContent=autoCleanup?'Auto-clean On':'Auto-clean Off';
    autoNotesBtn.classList.toggle('active',autoCleanup);
  }

  function updateDigitPad(){
    const counts=new Array(10).fill(0);
    for(let r=0;r<GRID_SIZE;r++)
      for(let c=0;c<GRID_SIZE;c++)
        if(grid[r][c]&&!hasConflict(r,c)) counts[grid[r][c]]++;
    document.querySelectorAll('#digitPad button').forEach(btn=>{
      const n=Number(btn.textContent);
      if(n>=1&&n<=9){
        const done=counts[n]===9;
        btn.classList.toggle('completed',done);
        btn.disabled=done;
      }
    });
  }

  function updateStatus(){
    if(riftSequenceRunning) return;
    if(riftState.active){ setStatus('Rift node found. Tap the marked cell.'); return; }
    if(!selected){ setStatus('Tap a cell to select it, then tap a number.'); return; }
    const {r,c}=selected;
    const isFixed=startingGrid[r][c]!==0;
    const value=grid[r][c];
    const nc=notes[r][c].size;
    if(isFixed){ setStatus('Starting number — this cell cannot be changed.'); return; }
    if(notesMode&&!value){ setStatus(nc?`Notes mode on — ${nc} pencil mark${nc===1?'':'s'} here.`:'Notes mode on — tap numbers to toggle pencil marks.'); return; }
    if(!value){ setStatus(nc?`Empty cell — ${nc} pencil mark${nc===1?'':'s'}.`:'Empty cell selected.'); return; }
    if(hasConflict(r,c)) setStatus(`Conflict! This ${value} clashes with another in its row, column, or block.`);
    else setStatus(`You placed a ${value} here.${autoCleanup?' Related notes cleaned up.':''}`);
  }

  function makeNotesNode(r, c){
    const box=document.createElement('div');
    box.className='notes';
    for(let n=1;n<=9;n++){
      const span=document.createElement('span');
      span.textContent=notes[r][c].has(n)?String(n):'';
      box.appendChild(span);
    }
    return box;
  }

  function render(){
    boardEl.innerHTML='';
    const fragment=document.createDocumentFragment();
    const blocks=Array.from({length:9},()=>{
      const div=document.createElement('div');
      div.className='block';
      return div;
    });
    for(let r=0;r<GRID_SIZE;r++){
      for(let c=0;c<GRID_SIZE;c++){
        const cell=document.createElement('button');
        cell.type='button';
        cell.className='cell';
        cell.dataset.r=r;
        cell.dataset.c=c;
        const isFixed=startingGrid[r][c]!==0;
        const isUser=!isFixed&&grid[r][c]!==0;
        if(isFixed) cell.classList.add('fixed');
        if(isUser) cell.classList.add('user');
        if(isRelated(r,c)) cell.classList.add('related');
        if(selected&&selected.r===r&&selected.c===c) cell.classList.add('selected');
        if(hasConflict(r,c)) cell.classList.add('error');
        const isRiftNode=riftState.active && riftState.nodes.some(node=>node.r===r&&node.c===c);
        if(isRiftNode) cell.classList.add('rift-node');
        cell.setAttribute('aria-label',`Row ${r+1} Column ${c+1}${grid[r][c]?`, value ${grid[r][c]}`:', empty'}${isRiftNode?', rift node':''}`);
        if(grid[r][c]) cell.textContent=grid[r][c];
        else if(notes[r][c].size) cell.appendChild(makeNotesNode(r,c));
        cell.addEventListener('click',()=>{
          if(interactionLocked) return;
          if(isRiftNode){ openRiftModal(); return; }
          if(riftState.active){ setStatus('The rift is still open. Tap the marked cell.'); return; }
          selected={r,c}; render(); saveGame();
        });
        blocks[Math.floor(r/3)*3+Math.floor(c/3)].appendChild(cell);
      }
    }
    blocks.forEach(block=>fragment.appendChild(block));
    boardEl.appendChild(fragment);
    updateStats(); updateToggles(); updateStatus(); updateDigitPad();
  }

  function celebrate(){
    document.querySelectorAll('.cell').forEach(el=>{
      el.classList.add('okflash');
      setTimeout(()=>el.classList.remove('okflash'),450);
    });
    document.querySelector('.board-shell').classList.add('victory-glow');
    vibrate([50,30,80]);
    // eslint-disable-next-line no-console
    console.log('game_won',{elapsed,difficulty:difficultyEl.value});
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  function saveGame(){
    const encodedLastSolvable=lastSolvableSnapshot?{
      ...lastSolvableSnapshot,
      notes:lastSolvableSnapshot.notes.map(row=>row.map(s=>[...s]))
    }:null;
    const payload={
      grid, startingGrid,
      notes:notes.map(row=>row.map(s=>[...s])),
      selected, elapsed, notesMode, autoCleanup,
      difficulty:difficultyEl.value,
      lastSolvableSnapshot:encodedLastSolvable,
      riftState:serializeRiftState()
    };
    try{
      localStorage.setItem(STORAGE_KEY,JSON.stringify(payload));
    } catch(e){
      if(e instanceof DOMException && e.name==='QuotaExceededError'){
        setStatus('Auto-save failed: storage quota exceeded.');
      }
    }
  }

  function applyLoadedData(data){
    grid=data.grid;
    startingGrid=data.startingGrid||data.grid.map(row=>row.slice());
    notes=data.notes.map(row=>row.map(arr=>new Set(arr)));
    selected=data.selected;
    elapsed=normalizeElapsed(getPersistedElapsedTime(data));
    notesMode=!!data.notesMode;
    autoCleanup=data.autoCleanup!==false;
    difficultyEl.value=data.difficulty||'medium';
    history=[]; future=[];
    boardShellEl.classList.remove('victory-glow');
    clearRiftVisualState();
    if(data.lastSolvableSnapshot && data.lastSolvableSnapshot.grid && data.lastSolvableSnapshot.notes){
      lastSolvableSnapshot={
        ...data.lastSolvableSnapshot,
        grid:cloneGrid(data.lastSolvableSnapshot.grid),
        notes:data.lastSolvableSnapshot.notes.map(row=>row.map(arr=>new Set(arr)))
      };
    } else {
      lastSolvableSnapshot=null;
    }
    restoreRiftStateFromSave(data);
    render(); startTimer(); hideSplash();
    setStatus(riftState.active?'Rift node found. Tap the marked cell.':'Resumed saved game.');
    boardWasSolvable=hasAnySolution(grid);
    if(!lastSolvableSnapshot && boardWasSolvable) captureLastSolvableSnapshot();
  }

  // ── Theme ─────────────────────────────────────────────────────────────────

  function applyTheme(theme){
    document.body.classList.toggle('light',theme==='light');
    document.documentElement.style.background=theme==='light'?'#eef2ff':'#0b1220';
    themeBtn.textContent=`Theme: ${theme==='light'?'Light':'Dark'}`;
    document.querySelector('meta[name="theme-color"]').setAttribute('content',theme==='light'?'#f8fafc':'#111827');
    localStorage.setItem(THEME_KEY,theme);
  }

  function toggleTheme(){ applyTheme(document.body.classList.contains('light')?'dark':'light'); }

  // ── Puzzle generation ─────────────────────────────────────────────────────

  function shuffle(a){
    const out=a.slice();
    for(let i=out.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [out[i],out[j]]=[out[j],out[i]]; }
    return out;
  }

  function createSolvedBoard(){
    const base=3, side=base*base;
    const pattern=(r,c)=>(base*(r%base)+Math.floor(r/base)+c)%side;
    const rBase=[0,1,2];
    const rowsOrder=shuffle(rBase).flatMap(g=>shuffle(rBase).map(r=>g*base+r));
    const colsOrder=shuffle(rBase).flatMap(g=>shuffle(rBase).map(c=>g*base+c));
    const nums=shuffle([1,2,3,4,5,6,7,8,9]);
    return rowsOrder.map(r=>colsOrder.map(c=>nums[pattern(r,c)]));
  }

  function countSolutions(board, limit=2){
    let count=0;
    function solve(b){
      let best=null;
      for(let r=0;r<GRID_SIZE;r++){
        for(let c=0;c<GRID_SIZE;c++){
          if(b[r][c]===0){
            const cand=candidatesForBoard(b,r,c);
            if(cand.length===0) return;
            if(!best||cand.length<best.cand.length) best={r,c,cand};
          }
        }
      }
      if(!best){ count++; return; }
      for(const n of best.cand){
        b[best.r][best.c]=n;
        solve(b);
        if(count>=limit) break;
        b[best.r][best.c]=0;
      }
      b[best.r][best.c]=0;
    }
    solve(board.map(row=>row.slice()));
    return count;
  }

  function makePuzzleFromSolved(solved, difficulty){
    const removals={easy:40,medium:50,hard:56};
    const target=removals[difficulty]||50;
    const board=solved.map(r=>r.slice());
    const cells=shuffle(Array.from({length:TOTAL_CELLS},(_,i)=>i));
    let removed=0;
    for(const idx of cells){
      if(removed>=target) break;
      const r=Math.floor(idx/GRID_SIZE), c=idx%GRID_SIZE;
      const backup=board[r][c];
      board[r][c]=0;
      if(countSolutions(board,2)!==1) board[r][c]=backup;
      else removed++;
    }
    return board;
  }

  // ── Game actions ──────────────────────────────────────────────────────────

  function startTimer(){
    if(timerId) clearInterval(timerId);
    timerId=setInterval(()=>{ elapsed++; updateStats(); saveGame(); },1000);
  }

  function newGame(){
    const solved=createSolvedBoard();
    grid=makePuzzleFromSolved(solved,difficultyEl.value);
    startingGrid=cloneGrid(grid);
    notes=Array.from({length:GRID_SIZE},()=>Array.from({length:GRID_SIZE},()=>new Set()));
    fillNotesAll();
    selected=null; elapsed=0; history=[]; future=[];
    boardShellEl.classList.remove('victory-glow');
    clearRiftVisualState();
    resetRiftState();
    movesSinceSolvabilityCheck=0;
    captureLastSolvableSnapshot();
    render(); startTimer(); saveGame(); hideSplash();
    setStatus(`New ${difficultyEl.value} Shandoku game loaded.`);
  }

  function placeNumber(n){
    if(!canInteractWithBoard()) return;
    if(!selected) return;
    const {r,c}=selected;
    if(startingGrid[r][c]!==0){ setStatus('That cell is a starting number.'); return; }
    pushHistory();
    if(notesMode){
      if(grid[r][c]!==0){ history.pop(); setStatus('Clear the number first before adding notes.'); return; }
      if(notes[r][c].has(n)) notes[r][c].delete(n); else notes[r][c].add(n);
      vibrate(10);
      applyPostMovePipeline({ shouldEvaluateRift:false }); return;
    }
    grid[r][c]=n;
    notes[r][c].clear();
    autoCleanNotesAround(r,c,n);
    const introducedConflict=hasConflict(r,c);
    applyPostMovePipeline({ riftOptions:{conflictIntroduced:introducedConflict} });
    if(introducedConflict){
      vibrate([10,50,10]);
      const cellEl=boardEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
      if(cellEl){ cellEl.classList.add('error-shake'); setTimeout(()=>cellEl.classList.remove('error-shake'),400); }
    } else {
      vibrate(10);
    }
    if(isSolved()){ setStatus('Solved. Nice work.'); celebrate(); }
  }

  function clearSelected(){
    if(!canInteractWithBoard()) return;
    if(!selected) return;
    const {r,c}=selected;
    if(startingGrid[r][c]!==0){ setStatus('Starting number — this cell cannot be changed.'); return; }
    pushHistory();
    grid[r][c]=0; notes[r][c].clear();
    applyPostMovePipeline({ riftOptions:{conflictIntroduced:false} });
    setStatus('Cell cleared.');
  }

  function jumpToNextEmpty(){
    if(!canInteractWithBoard()) return false;
    const startIndex=selected?selected.r*GRID_SIZE+selected.c:-1;
    for(let offset=1;offset<=TOTAL_CELLS;offset++){
      const idx=(startIndex+offset+TOTAL_CELLS)%TOTAL_CELLS;
      const r=Math.floor(idx/9), c=idx%9;
      if(grid[r][c]===0&&startingGrid[r][c]===0){
        selected={r,c}; render(); saveGame();
        setStatus('Jumped to next empty cell.');
        return true;
      }
    }
    setStatus('No empty cells remaining.');
    return false;
  }

  function giveHint(){
    if(!canInteractWithBoard()) return;
    let best=null;
    outer: for(let r=0;r<GRID_SIZE;r++){
      for(let c=0;c<GRID_SIZE;c++){
        if(grid[r][c]===0){
          const cand=candidatesFor(r,c);
          if(cand.length===1){ best={r,c,v:cand[0]}; break outer; }
          if(!best&&cand.length) best={r,c,v:cand[0]};
        }
      }
    }
    if(!best){ setStatus('Board is already complete.'); return; }
    selected={r:best.r,c:best.c};
    render(); saveGame();
    setStatus(`Hint: try a ${best.v} in this cell.`);
  }

  function checkBoard(){
    if(!canInteractWithBoard()) return;
    render();
    if(isSolved()) setStatus('Everything checks out. Puzzle solved.');
    else if(countErrors()===0) setStatus(`No conflicts found. ${TOTAL_CELLS-countFilled()} cells still empty.`);
    else setStatus(`${countErrors()} conflicting cell(s) found. Red marks the exact conflicting cells.`);
  }

  function solveBoard(){
    if(!canInteractWithBoard()) return;
    pushHistory();
    const b=cloneGrid(grid);
    function solve(){
      let best=null;
      for(let r=0;r<GRID_SIZE;r++){
        for(let c=0;c<GRID_SIZE;c++){
          if(b[r][c]===0){
            const cand=candidatesForBoard(b,r,c);
            if(cand.length===0) return false;
            if(!best||cand.length<best.cand.length) best={r,c,cand};
          }
        }
      }
      if(!best) return true;
      for(const n of best.cand){
        b[best.r][best.c]=n;
        if(solve()) return true;
        b[best.r][best.c]=0;
      }
      return false;
    }
    const ok=solve();
    grid=b;
    notes=Array.from({length:GRID_SIZE},()=>Array.from({length:GRID_SIZE},()=>new Set()));
    applyPostMovePipeline({ shouldEvaluateRift:false, shouldCaptureSolvable:true });
    if(ok) setStatus('Solved.');
    else setStatus('Could not solve — fix the conflicts first.');
  }

  function moveSelection(dr, dc){
    if(!canInteractWithBoard({showStatus:false})) return;
    if(!selected) selected={r:0,c:0};
    else selected={r:(selected.r+dr+GRID_SIZE)%GRID_SIZE, c:(selected.c+dc+GRID_SIZE)%GRID_SIZE};
    render(); saveGame();
  }

  function restoreLastSolvableState(){
    if(!lastSolvableSnapshot){
      setStatus('No solvable snapshot available yet.');
      return;
    }
    restoreSnapshot(lastSolvableSnapshot);
    boardWasSolvable=true;
    setStatus('Returned to the last solvable state.');
  }

  function closeRift(returnMessage='Rift closed.'){
    clearRiftVisualState();
    setStatus(returnMessage);
    saveGame();
    notifyRiftHook('onResolve', { message:returnMessage, rift:serializeRiftState(), snapshot:snapshotCurrentState() });
    if(lastFocusedBeforeRiftModal && typeof lastFocusedBeforeRiftModal.focus === 'function'){
      lastFocusedBeforeRiftModal.focus();
    }
    lastFocusedBeforeRiftModal = null;
  }

  function registerRiftExtension(extension={}){
    const dispose = [];
    ['onTrigger','onResolve'].forEach(hookName => {
      const handler = extension[hookName];
      if(typeof handler !== 'function') return;
      riftExtensionHooks[hookName].push(handler);
      dispose.push(()=>{
        riftExtensionHooks[hookName] = riftExtensionHooks[hookName].filter(fn=>fn!==handler);
      });
    });
    return () => dispose.forEach(fn=>fn());
  }

  // ── Build digit pad ───────────────────────────────────────────────────────

  function buildDigitPad(){
    const pad=document.getElementById('digitPad');
    for(let n=1;n<=GRID_SIZE;n++){
      const btn=document.createElement('button');
      btn.type='button'; btn.textContent=n;
      btn.setAttribute('aria-label',`Enter ${n}`);
      btn.addEventListener('click',()=>placeNumber(n));
      pad.appendChild(btn);
    }
    const erase=document.createElement('button');
    erase.type='button'; erase.textContent='⌫';
    erase.setAttribute('aria-label','Clear selected cell');
    erase.addEventListener('click',clearSelected);
    pad.appendChild(erase);
  }

  // ── Events ────────────────────────────────────────────────────────────────

  boardEl.addEventListener('touchstart',e=>{
    if(interactionLocked) return;
    const t=e.changedTouches&&e.changedTouches[0];
    if(t) touchStart={x:t.clientX,y:t.clientY};
  },{passive:true});

  boardEl.addEventListener('touchend',e=>{
    if(interactionLocked) return;
    if(!touchStart) return;
    const t=e.changedTouches&&e.changedTouches[0];
    if(!t) return;
    const dx=t.clientX-touchStart.x, dy=t.clientY-touchStart.y;
    const absX=Math.abs(dx), absY=Math.abs(dy);
    touchStart=null;
    if(Math.max(absX,absY)<28) return;
    if(absX>absY) moveSelection(0,dx>0?1:-1);
    else moveSelection(dy>0?1:-1,0);
  },{passive:true});

  document.getElementById('newGameBottomBtn').onclick=newGame;

  const settingsModal=document.getElementById('settingsModal');
  document.getElementById('settingsBtn').onclick=()=>{ settingsModal.hidden=false; };
  document.getElementById('settingsCloseBtn').onclick=()=>{ settingsModal.hidden=true; };
  document.getElementById('settingsBackdrop').onclick=()=>{ settingsModal.hidden=true; };

  document.getElementById('resumeBottomBtn').onclick=()=>{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(!raw){ setStatus('No saved game found on this device yet.'); return; }
    try{ applyLoadedData(JSON.parse(raw)); settingsModal.hidden=true; } catch(e){ console.error('Failed to load saved game:',e); setStatus('Could not load saved game.'); }
  };

  document.getElementById('hintBtn').onclick=giveHint;
  document.getElementById('checkBtn').onclick=checkBoard;
  document.getElementById('solveBtn').onclick=solveBoard;
  document.getElementById('nextEmptyBtn').onclick=jumpToNextEmpty;
  document.getElementById('undoBtn').onclick=undo;
  document.getElementById('redoBtn').onclick=redo;

  notesModeBtn.onclick=()=>{ notesMode=!notesMode; render(); saveGame(); };
  autoNotesBtn.onclick=()=>{ autoCleanup=!autoCleanup; render(); saveGame(); };

  document.getElementById('fillNotesBtn').onclick=()=>{ fillNotesAll(); render(); saveGame(); setStatus('Filled notes for all empty cells.'); };

  themeBtn.onclick=toggleTheme;

  riftBackdrop.onclick=()=>closeRift('You stepped back from the rift.');
  riftReturnBtn.onclick=()=>closeRift('You returned to the puzzle.');
  riftRestoreBtn.onclick=()=>{
    restoreLastSolvableState();
    closeRift('Restored to the last solvable state.');
  };
  riftFreshBtn.onclick=()=>{
    closeRift('Starting fresh.');
    newGame();
  };

  // Add to Home Screen
  let deferredInstallPrompt=null;
  const installBtn=document.getElementById('installBtn');
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();
    deferredInstallPrompt=e;
    installBtn.hidden=false;
  });
  installBtn.onclick=async()=>{
    if(!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt=null;
    installBtn.hidden=true;
  };
  window.addEventListener('appinstalled',()=>{
    installBtn.hidden=true;
    deferredInstallPrompt=null;
  });

  document.addEventListener('keydown',e=>{
    if(interactionLocked && e.key!=='Escape') return;
    if(e.key==='Escape' && !riftModal.hidden){ closeRift('You returned to the puzzle.'); return; }
    if(e.key>='1'&&e.key<='9') placeNumber(Number(e.key));
    else if(['Backspace','Delete','0'].includes(e.key)) clearSelected();
    else if(e.key==='ArrowUp') moveSelection(-1,0);
    else if(e.key==='ArrowDown') moveSelection(1,0);
    else if(e.key==='ArrowLeft') moveSelection(0,-1);
    else if(e.key==='ArrowRight') moveSelection(0,1);
    else if(e.key.toLowerCase()==='n') notesModeBtn.click();
    else if(e.key.toLowerCase()==='h') giveHint();
    else if(e.key.toLowerCase()==='z'&&(e.ctrlKey||e.metaKey)) undo();
    else if(e.key.toLowerCase()==='y'&&(e.ctrlKey||e.metaKey)) redo();
  });

  // ── Boot ──────────────────────────────────────────────────────────────────

  function exposeTestApi(){
    window.__shandokuTest = {
      getStateSummary(){
        return {
          selected:selected?{...selected}:null,
          elapsed,
          notesMode,
          autoCleanup,
          errors:countErrors(),
          filled:countFilled(),
          boardWasSolvable,
          hasLastSolvableSnapshot:!!lastSolvableSnapshot
        };
      },
      setBoardState(nextState={}){
        if(!nextState.grid || !Array.isArray(nextState.grid) || nextState.grid.length!==GRID_SIZE){
          throw new Error('setBoardState requires a 9x9 grid.');
        }
        const nextGrid = nextState.grid.map(row => row.slice());
        const nextStartingGrid = nextState.startingGrid ? nextState.startingGrid.map(row => row.slice()) : nextGrid.map(row => row.slice());
        const nextNotes = nextState.notes
          ? nextState.notes.map(row => row.map(arr => new Set(Array.isArray(arr) ? arr : [])))
          : Array.from({length:GRID_SIZE},()=>Array.from({length:GRID_SIZE},()=>new Set()));
        grid=nextGrid;
        startingGrid=nextStartingGrid;
        notes=nextNotes;
        selected=nextState.selected ? { ...nextState.selected } : null;
        history=[];
        future=[];
        clearRiftVisualState();
        resetRiftState();
        boardWasSolvable=hasAnySolution(grid);
        if(boardWasSolvable) captureLastSolvableSnapshot();
        render();
        saveGame();
      },
      forceEvaluateRift(){
        evaluateRiftTrigger('player-move',{ force:true, conflictIntroduced:true });
      },
      getRiftState(){
        return {
          ...serializeRiftState(),
          sequenceRunning:riftSequenceRunning,
          interactionLocked
        };
      },
      restoreLastSolvable(){
        restoreLastSolvableState();
      },
      clearSave(){
        localStorage.removeItem(STORAGE_KEY);
      }
    };
    window.__shandokuInternal = {
      registerRiftExtension
    };
  }

  applyTheme(localStorage.getItem(THEME_KEY)||'dark');
  buildDigitPad();
  if(TEST_MODE) exposeTestApi();

  // Defer game init until after the first paint so the splash animates.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw){
      try{
        const saved=JSON.parse(raw);
        const modal=document.getElementById('resumeModal');
        timeStat.textContent=formatTime(getPersistedElapsedTime(saved));
        modal.hidden=false;
        document.getElementById('resumeYesBtn').onclick=()=>{ modal.hidden=true; applyLoadedData(saved); };
        document.getElementById('resumeNoBtn').onclick=()=>{ modal.hidden=true; newGame(); };
      } catch(e){ console.error('Failed to restore saved game:',e); newGame(); }
    } else {
      newGame();
    }
  }));
})();
