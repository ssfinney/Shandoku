(() => {
  const STORAGE_KEY = 'shandoku-wife-edition-save-v1';
  const THEME_KEY = 'shandoku-wife-edition-theme-v1';
  const GRID_SIZE = 9;
  const HISTORY_LIMIT = 200;

  const boardEl = document.getElementById('board');
  const statusEl = document.getElementById('status');
  const difficultyEl = document.getElementById('difficulty');
  const timeStat = document.getElementById('timeStat');
  const filledStat = document.getElementById('filledStat');
  const errorStat = document.getElementById('errorStat');
  const notesModeBtn = document.getElementById('notesModeBtn');
  const autoNotesBtn = document.getElementById('autoNotesBtn');
  const themeBtn = document.getElementById('themeBtn');

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

  function isSolved(){ return countFilled()===81 && countErrors()===0; }

  function isRelated(r, c){
    if(!selected || (selected.r===r && selected.c===c)) return false;
    return selected.r===r || selected.c===c ||
      (Math.floor(selected.r/3)===Math.floor(r/3) && Math.floor(selected.c/3)===Math.floor(c/3));
  }

  function formatTime(t){
    return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
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
    render(); updateStats(); updateToggles(); saveGame();
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

  function setStatus(msg){ statusEl.textContent=msg; }

  function updateStats(){
    timeStat.textContent=formatTime(elapsed);
    filledStat.textContent=`${countFilled()}/81`;
    errorStat.textContent=String(countErrors());
  }

  function updateToggles(){
    notesModeBtn.textContent=notesMode?'Notes On':'Notes Off';
    notesModeBtn.classList.toggle('active',notesMode);
    autoNotesBtn.textContent=autoCleanup?'Auto-clean On':'Auto-clean Off';
    autoNotesBtn.classList.toggle('active',autoCleanup);
    document.getElementById('toggleNotesBottomBtn').textContent=notesMode?'Notes On':'Notes Off';
    document.getElementById('toggleNotesBottomBtn').classList.toggle('active',notesMode);
    document.getElementById('toggleAutoBottomBtn').textContent=autoCleanup?'Auto-clean On':'Auto-clean Off';
    document.getElementById('toggleAutoBottomBtn').classList.toggle('active',autoCleanup);
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
    if(!selected){ setStatus('Tap a cell, then tap a number. Red means that exact cell conflicts with another value in its row, column, or 3×3 block.'); return; }
    const {r,c}=selected;
    const isFixed=startingGrid[r][c]!==0;
    const value=grid[r][c];
    const nc=notes[r][c].size;
    if(isFixed){ setStatus(`r${r+1}c${c+1} is a starting number.`); return; }
    if(notesMode&&!value){ setStatus(`Notes mode is on. r${r+1}c${c+1} has ${nc} note${nc===1?'':'s'}.`); return; }
    if(!value){ setStatus(`r${r+1}c${c+1} is empty.${nc?` It has ${nc} note${nc===1?'':'s'}.`:''}`); return; }
    if(hasConflict(r,c)) setStatus(`r${r+1}c${c+1} is red because that exact cell conflicts with another ${value} in its row, column, or 3×3 block.`);
    else setStatus(`r${r+1}c${c+1} contains your ${value}.${autoCleanup?' Related notes were auto-cleaned.':''}`);
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
    for(let r=0;r<GRID_SIZE;r++){
      for(let c=0;c<GRID_SIZE;c++){
        const cell=document.createElement('button');
        cell.type='button';
        cell.className='cell';
        const isFixed=startingGrid[r][c]!==0;
        const isUser=!isFixed&&grid[r][c]!==0;
        if(isFixed) cell.classList.add('fixed');
        if(isUser) cell.classList.add('user');
        if(isRelated(r,c)) cell.classList.add('related');
        if(selected&&selected.r===r&&selected.c===c) cell.classList.add('selected');
        if(hasConflict(r,c)) cell.classList.add('error');
        if(c===2||c===5) cell.classList.add('block-right');
        if(r===2||r===5) cell.classList.add('block-bottom');
        cell.setAttribute('aria-label',`Row ${r+1} Column ${c+1}`);
        if(grid[r][c]) cell.textContent=grid[r][c];
        else if(notes[r][c].size) cell.appendChild(makeNotesNode(r,c));
        cell.addEventListener('click',()=>{ selected={r,c}; render(); saveGame(); });
        boardEl.appendChild(cell);
      }
    }
    updateStats(); updateToggles(); updateStatus(); updateDigitPad();
  }

  function celebrate(){
    document.querySelectorAll('.cell').forEach(el=>{
      el.classList.add('okflash');
      setTimeout(()=>el.classList.remove('okflash'),450);
    });
    document.querySelector('.board-shell').classList.add('victory-glow');
    vibrate([50,30,80]);
    console.log('game_won',{elapsed,difficulty:difficultyEl.value});
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  function saveGame(){
    const payload={
      grid, startingGrid,
      notes:notes.map(row=>row.map(s=>[...s])),
      selected, elapsed, notesMode, autoCleanup,
      difficulty:difficultyEl.value
    };
    localStorage.setItem(STORAGE_KEY,JSON.stringify(payload));
  }

  function applyLoadedData(data){
    grid=data.grid;
    startingGrid=data.startingGrid||data.grid.map(row=>row.map(v=>v!==0?v:0));
    notes=data.notes.map(row=>row.map(arr=>new Set(arr)));
    selected=data.selected;
    elapsed=data.elapsed||0;
    notesMode=!!data.notesMode;
    autoCleanup=data.autoCleanup!==false;
    difficultyEl.value=data.difficulty||'medium';
    history=[]; future=[];
    render(); startTimer(); setStatus('Resumed saved game.');
  }

  // ── Theme ─────────────────────────────────────────────────────────────────

  function applyTheme(theme){
    document.body.classList.toggle('light',theme==='light');
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
    const cells=shuffle(Array.from({length:81},(_,i)=>i));
    let removed=0;
    for(const idx of cells){
      if(removed>=target) break;
      const r=Math.floor(idx/9), c=idx%9;
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
    render(); startTimer(); saveGame();
    setStatus(`New ${difficultyEl.value} Shandoku game loaded.`);
  }

  function placeNumber(n){
    if(!selected) return;
    const {r,c}=selected;
    if(startingGrid[r][c]!==0){ setStatus('That cell is a starting number.'); return; }
    pushHistory();
    if(notesMode){
      if(grid[r][c]!==0){ history.pop(); setStatus('Clear the number first before adding notes.'); return; }
      if(notes[r][c].has(n)) notes[r][c].delete(n); else notes[r][c].add(n);
      vibrate(10);
      render(); saveGame(); return;
    }
    grid[r][c]=n;
    notes[r][c].clear();
    autoCleanNotesAround(r,c,n);
    render(); saveGame();
    if(hasConflict(r,c)){
      vibrate([10,50,10]);
      const cellEl=boardEl.children[r*9+c];
      if(cellEl){ cellEl.classList.add('error-shake'); setTimeout(()=>cellEl.classList.remove('error-shake'),400); }
    } else {
      vibrate(10);
    }
    if(isSolved()){ setStatus('Solved. Nice work.'); celebrate(); }
  }

  function clearSelected(){
    if(!selected) return;
    const {r,c}=selected;
    if(startingGrid[r][c]!==0){ setStatus('That cell is a starting number.'); return; }
    pushHistory();
    grid[r][c]=0; notes[r][c].clear();
    render(); saveGame();
    setStatus(`Cleared r${r+1}c${c+1}.`);
  }

  function jumpToNextEmpty(){
    const startIndex=selected?selected.r*9+selected.c:-1;
    for(let offset=1;offset<=81;offset++){
      const idx=(startIndex+offset+81)%81;
      const r=Math.floor(idx/9), c=idx%9;
      if(grid[r][c]===0&&startingGrid[r][c]===0){
        selected={r,c}; render(); saveGame();
        setStatus(`Moved to next empty cell: r${r+1}c${c+1}.`);
        return true;
      }
    }
    setStatus('No empty cells left.');
    return false;
  }

  function giveHint(){
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
    setStatus(`Hint: r${best.r+1}c${best.c+1} can take ${best.v}.`);
  }

  function checkBoard(){
    render();
    if(isSolved()) setStatus('Everything checks out. Puzzle solved.');
    else if(countErrors()===0) setStatus(`No conflicts found. ${81-countFilled()} cells still empty.`);
    else setStatus(`${countErrors()} conflicting cell(s) found. Red marks the exact conflicting cells.`);
  }

  function solveBoard(){
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
    solve();
    grid=b;
    notes=Array.from({length:GRID_SIZE},()=>Array.from({length:GRID_SIZE},()=>new Set()));
    render(); saveGame(); setStatus('Solved.');
  }

  function moveSelection(dr, dc){
    if(!selected) selected={r:0,c:0};
    else selected={r:(selected.r+dr+GRID_SIZE)%GRID_SIZE, c:(selected.c+dc+GRID_SIZE)%GRID_SIZE};
    render(); saveGame();
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
    const t=e.changedTouches&&e.changedTouches[0];
    if(t) touchStart={x:t.clientX,y:t.clientY};
  },{passive:true});

  boardEl.addEventListener('touchend',e=>{
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

  document.getElementById('newGame').onclick=newGame;
  document.getElementById('newGameBottomBtn').onclick=newGame;

  document.getElementById('resumeBtn').onclick=
  document.getElementById('resumeBottomBtn').onclick=()=>{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(!raw){ setStatus('No saved game found on this device yet.'); return; }
    try{ applyLoadedData(JSON.parse(raw)); } catch{ setStatus('Could not load saved game.'); }
  };

  document.getElementById('hintBtn').onclick=giveHint;
  document.getElementById('checkBtn').onclick=checkBoard;
  document.getElementById('solveBtn').onclick=solveBoard;
  document.getElementById('nextEmptyBtn').onclick=jumpToNextEmpty;
  document.getElementById('clearBtn').onclick=clearSelected;
  document.getElementById('undoBtn').onclick=undo;
  document.getElementById('redoBtn').onclick=redo;

  notesModeBtn.onclick=()=>{ notesMode=!notesMode; render(); saveGame(); };
  document.getElementById('toggleNotesBottomBtn').onclick=notesModeBtn.onclick;
  autoNotesBtn.onclick=()=>{ autoCleanup=!autoCleanup; render(); saveGame(); };
  document.getElementById('toggleAutoBottomBtn').onclick=autoNotesBtn.onclick;

  const fillNotesHandler=()=>{ fillNotesAll(); render(); saveGame(); setStatus('Filled notes for all empty cells using current candidates.'); };
  document.getElementById('fillNotesBtn').onclick=fillNotesHandler;
  document.getElementById('fillNotesBottomBtn').onclick=fillNotesHandler;

  themeBtn.onclick=toggleTheme;
  document.getElementById('toggleThemeBottomBtn').onclick=toggleTheme;

  document.addEventListener('keydown',e=>{
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

  applyTheme(localStorage.getItem(THEME_KEY)||'dark');
  buildDigitPad();

  const raw=localStorage.getItem(STORAGE_KEY);
  if(raw){
    try{
      const saved=JSON.parse(raw);
      if(confirm('Resume your saved game?')){
        applyLoadedData(saved);
      } else {
        newGame();
      }
    } catch{ newGame(); }
  } else {
    newGame();
  }
})();
