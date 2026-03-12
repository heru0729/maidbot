/**
 * play.js — ゲームモジュール v3
 * 囲碁/将棋/チェス/オセロ/アキネーター
 * モード: vs Bot（弱・普通・強） / サーバー内対戦 / オンライン対戦
 * 修正: オセロ絵文字UI・アキネーター対人・途中退出確認・招待バグ修正
 */

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    SlashCommandBuilder, MessageFlags
} = require('discord.js');

const EPH = { flags: MessageFlags.Ephemeral };

// ==================== 状態管理 ====================
const activeGames   = new Map(); // `${channelId}_${userId}` → state
const onlineMatches = new Map(); // matchId → match
const pendingInvites = new Map();// `${guildId}_${inviterId}` → invite
// 途中退出確認中
const pendingQuits  = new Map(); // key → true

function gk(channelId, userId) { return `${channelId}_${userId}`; }
const GAME_NAMES = { igo:'囲碁', shogi:'将棋', chess:'チェス', othello:'オセロ', aki:'アキネーター' };

// ==================== 囲碁 ====================
const IGO_SIZE = 9;
const IGO_COLS = 'ABCDEFGHJ';

function createIgoBoard() { return Array.from({length:IGO_SIZE}, ()=>Array(IGO_SIZE).fill(0)); }

function renderIgoBoard(board, lastMove) {
    const header = '　' + [...IGO_COLS].join(' ');
    const rows = board.map((row,y) => {
        const rn = String(IGO_SIZE-y).padStart(2,' ');
        const cells = row.map((c,x) => {
            if (lastMove&&lastMove[0]===x&&lastMove[1]===y) return c===1?'⊕':'⊗';
            return c===1?'●':c===2?'○':'┼';
        }).join('');
        return `${rn} ${cells}`;
    }).join('\n');
    return `\`\`\`\n${header}\n${rows}\n\`\`\``;
}

function igoGetGroup(board, x, y, color, vis=new Set()) {
    const k=`${x},${y}`; if(vis.has(k)) return {stones:[],liberties:new Set()}; vis.add(k);
    const g={stones:[[x,y]],liberties:new Set()};
    for(const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const nx=x+dx,ny=y+dy;
        if(nx<0||nx>=IGO_SIZE||ny<0||ny>=IGO_SIZE) continue;
        if(board[ny][nx]===0) g.liberties.add(`${nx},${ny}`);
        else if(board[ny][nx]===color) { const s=igoGetGroup(board,nx,ny,color,vis); g.stones.push(...s.stones); for(const l of s.liberties) g.liberties.add(l); }
    }
    return g;
}

function igoPlace(board, x, y, color) {
    const nb=board.map(r=>[...r]); nb[y][x]=color; const opp=color===1?2:1; let cap=0;
    for(const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const nx=x+dx,ny=y+dy; if(nx<0||nx>=IGO_SIZE||ny<0||ny>=IGO_SIZE) continue;
        if(nb[ny][nx]===opp) { const g=igoGetGroup(nb,nx,ny,opp); if(g.liberties.size===0) for(const [sx,sy] of g.stones){nb[sy][sx]=0;cap++;} }
    }
    const self=igoGetGroup(nb,x,y,color); if(self.liberties.size===0&&cap===0) return null;
    return {board:nb,captured:cap};
}

function botIgoMove(board, color, diff) {
    const moves=[];
    for(let y=0;y<IGO_SIZE;y++) for(let x=0;x<IGO_SIZE;x++) { if(board[y][x]!==0) continue; const r=igoPlace(board,x,y,color); if(r) moves.push({x,y,cap:r.captured}); }
    if(!moves.length) return null;
    if(diff==='弱') return moves[Math.floor(Math.random()*moves.length)];
    const caps=moves.filter(m=>m.cap>0);
    if(diff==='普通') return caps.length?caps[Math.floor(Math.random()*caps.length)]:moves[Math.floor(Math.random()*moves.length)];
    if(caps.length) return caps.sort((a,b)=>b.cap-a.cap)[0];
    const c=moves.filter(m=>m.x>=2&&m.x<=6&&m.y>=2&&m.y<=6);
    return c.length?c[Math.floor(Math.random()*c.length)]:moves[Math.floor(Math.random()*moves.length)];
}

// ==================== 将棋 ====================
function createShogiBoard() {
    const B=Array.from({length:9},()=>Array(9).fill(null));
    B[0]=[{t:'香',s:2},{t:'桂',s:2},{t:'銀',s:2},{t:'金',s:2},{t:'王',s:2},{t:'金',s:2},{t:'銀',s:2},{t:'桂',s:2},{t:'香',s:2}];
    B[1][7]={t:'飛',s:2};B[1][1]={t:'角',s:2}; for(let x=0;x<9;x++) B[2][x]={t:'歩',s:2};
    B[8]=[{t:'香',s:1},{t:'桂',s:1},{t:'銀',s:1},{t:'金',s:1},{t:'王',s:1},{t:'金',s:1},{t:'銀',s:1},{t:'桂',s:1},{t:'香',s:1}];
    B[7][1]={t:'飛',s:1};B[7][7]={t:'角',s:1}; for(let x=0;x<9;x++) B[6][x]={t:'歩',s:1};
    return B;
}
function renderShogiBoard(board,sel,vms) {
    const vmSet=new Set((vms||[]).map(([x,y])=>`${x},${y}`));
    let o='```\n　９８７６５４３２１\n';
    for(let y=0;y<9;y++){o+='一二三四五六七八九'[y]+' ';for(let x=0;x<9;x++){const p=board[y][x];const isSel=sel&&sel[0]===x&&sel[1]===y;o+=!p?(vmSet.has(`${x},${y}`)?'・':'　'):(isSel?`[${p.t}]`:p.t);}o+='\n';}
    return o+'```';
}
function getShogiMoves(board,x,y) {
    const p=board[y][x]; if(!p) return [];
    const m=[],s=p.s,fw=s===1?-1:1;
    const add=(nx,ny)=>{if(nx<0||nx>=9||ny<0||ny>=9)return false;if(board[ny][nx]?.s===s)return false;m.push([nx,ny]);return!board[ny][nx];};
    const sl=(dx,dy)=>{let nx=x+dx,ny=y+dy;while(add(nx,ny)){nx+=dx;ny+=dy;}};
    const t=p.t;
    if(t==='歩')add(x,y+fw);
    else if(t==='香'){let ny=y+fw;while(ny>=0&&ny<9){if(!add(x,ny))break;ny+=fw;}}
    else if(t==='桂'){add(x-1,y+fw*2);add(x+1,y+fw*2);}
    else if(t==='銀')[[0,fw],[1,fw],[-1,fw],[1,-fw],[-1,-fw]].forEach(([dx,dy])=>add(x+dx,y+dy));
    else if(t==='金'||['歩+','銀+','桂+','香+'].includes(t))[[0,fw],[1,fw],[-1,fw],[1,0],[-1,0],[0,-fw]].forEach(([dx,dy])=>add(x+dx,y+dy));
    else if(t==='王')[[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dx,dy])=>add(x+dx,y+dy));
    else if(t==='角'){sl(1,1);sl(1,-1);sl(-1,1);sl(-1,-1);}
    else if(t==='飛'){sl(1,0);sl(-1,0);sl(0,1);sl(0,-1);}
    else if(t==='角+'){sl(1,1);sl(1,-1);sl(-1,1);sl(-1,-1);[[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy])=>add(x+dx,y+dy));}
    else if(t==='飛+'){sl(1,0);sl(-1,0);sl(0,1);sl(0,-1);[[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dx,dy])=>add(x+dx,y+dy));}
    return m;
}
const SV={'王':10000,'飛':9,'角':8,'金':6,'銀':5,'桂':4,'香':3,'歩':1,'飛+':12,'角+':11,'歩+':4,'銀+':6,'桂+':5,'香+':4};
function botShogiMove(board,diff) {
    const m=[];
    for(let y=0;y<9;y++) for(let x=0;x<9;x++) { if(board[y][x]?.s!==2)continue; for(const[tx,ty] of getShogiMoves(board,x,y)) m.push({fx:x,fy:y,tx,ty,v:board[ty][tx]?(SV[board[ty][tx].t]||1):0}); }
    if(!m.length) return null;
    if(diff==='弱') return m[Math.floor(Math.random()*m.length)];
    const r=[...m].sort((a,b)=>b.v-a.v);
    if(diff==='普通') return r[Math.floor(Math.random()*Math.min(3,r.length))];
    return r[0];
}

// ==================== チェス ====================
function createChessBoard() {
    const B=Array.from({length:8},()=>Array(8).fill(null));
    const bk=['R','N','B','Q','K','B','N','R'];
    for(let x=0;x<8;x++){B[0][x]={t:bk[x],s:'b'};B[1][x]={t:'P',s:'b'};B[6][x]={t:'P',s:'w'};B[7][x]={t:bk[x],s:'w'};}
    return B;
}
const CE={w:{K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙'},b:{K:'♚',Q:'♛',R:'♜',B:'♝',N:'♞',P:'♟'}};
const CV={K:10000,Q:9,R:5,B:3,N:3,P:1};
function renderChessBoard(board,sel,vms) {
    const vs=new Set((vms||[]).map(([x,y])=>`${x},${y}`));
    let o='```\n  a b c d e f g h\n';
    for(let y=0;y<8;y++){o+=`${8-y} `;for(let x=0;x<8;x++){const p=board[y][x];const isSel=sel&&sel[0]===x&&sel[1]===y;const vm=vs.has(`${x},${y}`);o+=!p?(vm?'· ':((x+y)%2===0?'□ ':'■ ')):(CE[p.s][p.t]+(isSel?'*':' '));}o+=`${8-y}\n`;}
    return o+'  a b c d e f g h\n```';
}
function getChessMoves(board,x,y) {
    const p=board[y][x]; if(!p) return [];
    const m=[],s=p.s,fw=s==='w'?-1:1,sr=s==='w'?6:1;
    const add=(nx,ny,co=false,mo=false)=>{if(nx<0||nx>=8||ny<0||ny>=8)return false;const t=board[ny][nx];if(t?.s===s)return false;if(co&&!t)return false;if(mo&&t)return false;m.push([nx,ny]);return!t;};
    const sl=(dx,dy)=>{let nx=x+dx,ny=y+dy;while(add(nx,ny)){nx+=dx;ny+=dy;}};
    if(p.t==='P'){add(x,y+fw,false,true);if(y===sr&&!board[y+fw][x])add(x,y+fw*2,false,true);add(x+1,y+fw,true);add(x-1,y+fw,true);}
    else if(p.t==='R'){sl(1,0);sl(-1,0);sl(0,1);sl(0,-1);}
    else if(p.t==='N')[[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]].forEach(([dx,dy])=>add(x+dx,y+dy));
    else if(p.t==='B'){sl(1,1);sl(1,-1);sl(-1,1);sl(-1,-1);}
    else if(p.t==='Q'){sl(1,0);sl(-1,0);sl(0,1);sl(0,-1);sl(1,1);sl(1,-1);sl(-1,1);sl(-1,-1);}
    else if(p.t==='K')[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dx,dy])=>add(x+dx,y+dy));
    return m;
}
function botChessMove(board,diff) {
    const m=[];
    for(let y=0;y<8;y++) for(let x=0;x<8;x++){if(board[y][x]?.s!=='b')continue;for(const[tx,ty] of getChessMoves(board,x,y)) m.push({fx:x,fy:y,tx,ty,v:board[ty][tx]?(CV[board[ty][tx].t]||1):0});}
    if(!m.length) return null;
    if(diff==='弱') return m[Math.floor(Math.random()*m.length)];
    const r=[...m].sort((a,b)=>b.v-a.v);
    if(diff==='普通') return r[Math.floor(Math.random()*Math.min(3,r.length))];
    return r[0];
}

// ==================== オセロ ====================
const OS=8, DS=[[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];
// 絵文字マッピング
const NUM_EMOJI=['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

function createOthelloBoard() {
    const B=Array.from({length:OS},()=>Array(OS).fill(0));
    B[3][3]=2;B[3][4]=1;B[4][3]=1;B[4][4]=2; return B;
}

function renderOthelloBoard(board, validMoves) {
    // 有効手に左上から番号を割り当て
    const vmList = validMoves || [];
    const vmMap = new Map(); // `${x},${y}` → index
    vmList.forEach((([x,y],i) => vmMap.set(`${x},${y}`, i)));

    const colHeader = '　🇦🇧🇨🇩🇪🇫🇬🇭';
    let out = colHeader + '\n';
    for(let y=0;y<OS;y++){
        out += ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣'][y];
        for(let x=0;x<OS;x++){
            const k=`${x},${y}`;
            if(vmMap.has(k)) out += NUM_EMOJI[vmMap.get(k)];
            else if(board[y][x]===1) out += '⚫';
            else if(board[y][x]===2) out += '⚪';
            else out += '🟩';
        }
        out += '\n';
    }
    return out;
}

function getOthelloMoves(board, color) {
    const opp=color===1?2:1,m=[];
    for(let y=0;y<OS;y++) for(let x=0;x<OS;x++){
        if(board[y][x]!==0)continue;
        for(const[dx,dy] of DS){let nx=x+dx,ny=y+dy,f=0;while(nx>=0&&nx<OS&&ny>=0&&ny<OS&&board[ny][nx]===opp){nx+=dx;ny+=dy;f++;}if(f>0&&nx>=0&&nx<OS&&ny>=0&&ny<OS&&board[ny][nx]===color){m.push([x,y]);break;}}
    }
    return m;
}
function othelloPlace(board, x, y, color) {
    const opp=color===1?2:1,nb=board.map(r=>[...r]); nb[y][x]=color;
    for(const[dx,dy] of DS){let nx=x+dx,ny=y+dy;const fl=[];while(nx>=0&&nx<OS&&ny>=0&&ny<OS&&nb[ny][nx]===opp){fl.push([nx,ny]);nx+=dx;ny+=dy;}if(fl.length>0&&nx>=0&&nx<OS&&ny>=0&&ny<OS&&nb[ny][nx]===color)for(const[fx,fy] of fl)nb[fy][fx]=color;}
    return nb;
}
function countOthello(board){let b=0,w=0;for(const r of board)for(const c of r){if(c===1)b++;else if(c===2)w++;}return{b,w};}
function botOthelloMove(board,diff){
    const m=getOthelloMoves(board,2); if(!m.length)return null;
    if(diff==='弱')return m[Math.floor(Math.random()*m.length)];
    const co=m.filter(([x,y])=>(x===0||x===7)&&(y===0||y===7));if(co.length)return co[0];
    if(diff==='強'){const ed=m.filter(([x,y])=>x===0||x===7||y===0||y===7);if(ed.length)return ed[Math.floor(Math.random()*ed.length)];}
    return m[Math.floor(Math.random()*m.length)];
}

// ==================== アキネーター ====================
const AKI_Q=[
    '実在する人物ですか？','男性ですか？','現代の人物ですか？（21世紀に活躍）',
    '日本人ですか？','エンターテインメント業界の人ですか？','スポーツ選手ですか？',
    '政治家や実業家ですか？','漫画・アニメ・ゲームのキャラクターですか？',
    '架空の人物・キャラクターですか？','主人公・ヒーロー側のキャラクターですか？',
    '子供向けコンテンツのキャラクターですか？','人間ですか？','動物や生き物ですか？',
    '超能力や魔法を持っていますか？','武器を使いますか？',
    '有名な名言や決め台詞がありますか？','チームや仲間と行動することが多いですか？',
    'そのキャラクターは悪役ですか？','日本発祥のコンテンツですか？','グローバルに有名ですか？',
    '制服や特定のコスチュームを着ていますか？','そのキャラは映画に登場しますか？',
];
const AKI_CHARS=[
    {name:'孫悟空',q:[false,true,false,true,false,false,false,true,true,true,false,false,false,true,true,true,true,false,true,true,false,false]},
    {name:'うずまきナルト',q:[false,true,false,true,false,false,false,true,true,true,false,false,false,true,true,true,true,false,true,true,true,true]},
    {name:'モンキー・D・ルフィ',q:[false,true,false,true,false,false,false,true,true,true,false,true,false,true,true,true,true,false,true,true,false,true]},
    {name:'ピカチュウ',q:[false,false,false,true,false,false,false,true,true,true,true,false,true,false,false,true,false,false,true,true,false,false]},
    {name:'ドラえもん',q:[false,true,false,true,false,false,false,true,true,true,true,false,false,false,false,true,true,false,true,false,false,true]},
    {name:'スパイダーマン',q:[false,true,false,false,false,false,false,true,true,true,false,true,false,true,false,false,false,false,false,true,true,true]},
    {name:'バットマン',q:[false,true,false,false,false,false,false,true,true,true,false,true,false,false,true,false,false,false,false,true,true,true]},
    {name:'マリオ',q:[false,true,false,false,false,false,false,true,true,true,true,true,false,false,false,false,true,false,false,true,true,true]},
    {name:'ハリー・ポッター',q:[false,true,false,false,false,false,false,true,true,true,false,true,false,true,false,true,false,false,false,true,true,true]},
    {name:'セーラームーン',q:[false,false,false,true,false,false,false,true,true,true,false,true,false,true,false,true,true,false,true,true,true,true]},
    {name:'アンパンマン',q:[false,true,false,true,false,false,false,true,true,true,true,false,false,false,false,true,true,false,true,false,false,false]},
    {name:'坂本龍馬',q:[true,true,false,true,false,false,true,false,false,false,false,true,false,false,false,true,false,false,false,false,false,false]},
    {name:'リンク（ゼルダ）',q:[false,true,false,false,false,false,false,true,true,true,false,true,false,false,true,true,false,false,false,false,true,true]},
    {name:'碇シンジ',q:[false,true,false,true,false,false,false,true,true,true,false,true,false,false,false,false,false,false,true,false,false,false]},
    {name:'ルパン三世',q:[false,true,false,true,false,false,false,true,true,false,false,true,false,false,false,true,true,false,true,true,true,true]},
];
function akiScore(ch,ans){let s=0;for(let i=0;i<ans.length;i++){if(ans[i]===null||ch.q[i]===undefined)continue;s+=ans[i]===ch.q[i]?2:-1;}return s;}
function akiGuess(ans){return[...AKI_CHARS].sort((a,b)=>akiScore(b,ans)-akiScore(a,ans))[0];}

// ==================== コマンド定義 ====================
function getPlayCommands() {
    const addOpts = cmd => cmd
        .addStringOption(o=>o.setName('mode').setDescription('対戦モード').setRequired(false)
            .addChoices({name:'vs Bot',value:'bot'},{name:'サーバー内対戦（同サーバーのユーザーと）',value:'local'},{name:'オンライン対戦（他サーバーとマッチング）',value:'online'}))
        .addStringOption(o=>o.setName('difficulty').setDescription('Bot難易度（vs Botのみ）').setRequired(false)
            .addChoices({name:'弱（ランダム）',value:'弱'},{name:'普通（バランス）',value:'普通'},{name:'強（最善手）',value:'強'}))
        .addUserOption(o=>o.setName('opponent').setDescription('対戦相手（サーバー内対戦のみ）').setRequired(false));

    // アキネーターにも対人モードを追加（ヒントを2人で交互に考えるQ&A形式）
    const addAkiOpts = cmd => cmd
        .addStringOption(o=>o.setName('mode').setDescription('モード').setRequired(false)
            .addChoices({name:'ソロ（1人でプレイ）',value:'bot'},{name:'対人（2人で交互にヒント）',value:'local'}))
        .addUserOption(o=>o.setName('opponent').setDescription('対人モード: 一緒にプレイするユーザー').setRequired(false));

    return [
        addOpts(new SlashCommandBuilder().setName('igo').setDescription('囲碁をプレイします（9x9）')),
        addOpts(new SlashCommandBuilder().setName('shogi').setDescription('将棋をプレイします')),
        addOpts(new SlashCommandBuilder().setName('chess').setDescription('チェスをプレイします')),
        addOpts(new SlashCommandBuilder().setName('othello').setDescription('オセロをプレイします')),
        addAkiOpts(new SlashCommandBuilder().setName('aki').setDescription('アキネーター：頭の中のキャラを当てます')),
    ].map(c=>c.toJSON());
}

// ==================== 初期化 ====================
function initGame(type, mode, p1Id, p2Id, diff) {
    const base={type,mode,difficulty:diff,p1Id,p2Id,turn:1};
    if(type==='igo') return {...base,board:createIgoBoard(),passes:0,captures:[0,0],lastMove:null,phase:'select_col',selCol:null};
    if(type==='shogi') return {...base,board:createShogiBoard(),selected:null,validMoves:[],phase:'select',selCol:null};
    if(type==='chess') return {...base,board:createChessBoard(),turn:'w',selected:null,validMoves:[],phase:'select',selCol:null};
    if(type==='othello'){const b=createOthelloBoard();return{...base,board:b,validMoves:getOthelloMoves(b,1),phase:null,selCol:null};}
    if(type==='aki') return {type:'aki',mode,p1Id,p2Id,qIndex:0,answers:Array(AKI_Q.length).fill(null),turn:1};
}

function getModeLabel(s){
    if(s.mode==='bot') return `vs Bot（${s.difficulty}）`;
    if(s.mode==='local') return 'サーバー内対戦';
    return 'オンライン対戦';
}

// ==================== オセロUI ====================
function buildOthelloUI(state) {
    const vms = state.validMoves || [];
    // フェーズ: select_row → 選んだ列の行選択
    if(state.phase==='select_row'){
        const rb=new ActionRowBuilder();
        for(let i=0;i<8;i++){
            const ok=vms.some(([x,y])=>x===state.selCol&&y===i);
            rb.addComponents(new ButtonBuilder().setCustomId(`othello_row_${i}`).setLabel(NUM_EMOJI[i]).setStyle(ok?ButtonStyle.Success:ButtonStyle.Secondary).setDisabled(!ok));
        }
        return [rb, buildQuitRow('othello')];
    }
    // 列ボタン（有効手のある列のみ有効）
    const r=new ActionRowBuilder();
    for(let i=0;i<8;i++){const has=vms.some(([x])=>x===i);r.addComponents(new ButtonBuilder().setCustomId(`othello_col_${i}`).setLabel('ABCDEFGH'[i]).setStyle(has?ButtonStyle.Primary:ButtonStyle.Secondary).setDisabled(!has));}
    return [r, buildQuitRow('othello')];
}

// ==================== 共通UI ====================
function buildQuitRow(prefix) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${prefix}_resign`).setLabel('途中退出 🚪').setStyle(ButtonStyle.Danger)
    );
}

function buildConfirmQuitRow(prefix) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${prefix}_resign_confirm`).setLabel('本当に退出する').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${prefix}_resign_cancel`).setLabel('続ける').setStyle(ButtonStyle.Secondary),
    )];
}

function buildAllGameUI(state, p1name, p2name) {
    const ml=getModeLabel(state);
    const p1n=p1name||'P1';
    const p2n=p2name||(state.mode==='bot'?`Bot（${state.difficulty}）`:'P2');
    const isP1Turn = state.type==='chess'?(state.turn==='w'):(state.turn===1);
    const turnLabel = state.type==='chess'?(isP1Turn?`♔ ${p1n}の番`:`♚ ${p2n}の番`):(isP1Turn?`${p1n}の番`:`${p2n}の番`);

    if(state.type==='igo'){
        const em=new EmbedBuilder().setTitle(`🟤 囲碁 9×9 ｜ ${ml}`)
            .setDescription(renderIgoBoard(state.board,state.lastMove))
            .addFields({name:'● 黒',value:p1n,inline:true},{name:'○ 白',value:p2n,inline:true},{name:'手番',value:turnLabel,inline:true},{name:'取り石',value:`黒: ${state.captures[0]}　白: ${state.captures[1]}`,inline:true})
            .setColor(0x8B4513);
        let rows;
        if(state.phase==='select_row'){
            const r1=new ActionRowBuilder(),r2=new ActionRowBuilder();
            for(let i=0;i<5;i++) r1.addComponents(new ButtonBuilder().setCustomId(`igo_row_${i}`).setLabel(`${IGO_SIZE-i}`).setStyle(ButtonStyle.Primary));
            for(let i=5;i<9;i++) r2.addComponents(new ButtonBuilder().setCustomId(`igo_row_${i}`).setLabel(`${IGO_SIZE-i}`).setStyle(ButtonStyle.Primary));
            rows=[r1,r2,new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('igo_back').setLabel('← 戻る').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('igo_pass').setLabel('パス').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('igo_resign').setLabel('途中退出 🚪').setStyle(ButtonStyle.Danger),
            )];
        } else {
            const r1=new ActionRowBuilder(),r2=new ActionRowBuilder();
            for(let i=0;i<5;i++) r1.addComponents(new ButtonBuilder().setCustomId(`igo_col_${i}`).setLabel([...IGO_COLS][i]).setStyle(ButtonStyle.Secondary));
            for(let i=5;i<9;i++) r2.addComponents(new ButtonBuilder().setCustomId(`igo_col_${i}`).setLabel([...IGO_COLS][i]).setStyle(ButtonStyle.Secondary));
            rows=[r1,r2,new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('igo_pass').setLabel('パス').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('igo_resign').setLabel('途中退出 🚪').setStyle(ButtonStyle.Danger),
            )];
        }
        return {embed:em,rows};
    }
    if(state.type==='shogi'){
        const em=new EmbedBuilder().setTitle(`🎌 将棋 ｜ ${ml}`)
            .setDescription(renderShogiBoard(state.board,state.selected,state.validMoves))
            .addFields({name:'▲ 先手',value:p1n,inline:true},{name:'△ 後手',value:p2n,inline:true},{name:'手番',value:turnLabel,inline:true})
            .setColor(0xF5DEB3);
        const rn='一二三四五六七八九'.split('');
        let rows;
        if(state.phase==='select_dest'){
            const dr=[];let cr=null;
            for(const[mx,my] of (state.validMoves||[]).slice(0,20)){if(!cr||cr.components.length>=5){cr=new ActionRowBuilder();dr.push(cr);}cr.addComponents(new ButtonBuilder().setCustomId(`shogi_dest_${mx}_${my}`).setLabel(`${9-mx}${rn[my]}`).setStyle(ButtonStyle.Primary));if(dr.length>=4)break;}
            dr.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('shogi_cancel').setLabel('キャンセル').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('shogi_resign').setLabel('途中退出 🚪').setStyle(ButtonStyle.Danger)));
            rows=dr;
        } else if(state.phase==='select_row'){
            const r1=new ActionRowBuilder(),r2=new ActionRowBuilder();
            for(let i=0;i<5;i++) r1.addComponents(new ButtonBuilder().setCustomId(`shogi_row_${i}`).setLabel(rn[i]).setStyle(ButtonStyle.Primary));
            for(let i=5;i<9;i++) r2.addComponents(new ButtonBuilder().setCustomId(`shogi_row_${i}`).setLabel(rn[i]).setStyle(ButtonStyle.Primary));
            rows=[r1,r2,new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('shogi_cancel').setLabel('キャンセル').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('shogi_resign').setLabel('途中退出 🚪').setStyle(ButtonStyle.Danger))];
        } else {
            const r1=new ActionRowBuilder(),r2=new ActionRowBuilder();
            for(let i=0;i<5;i++) r1.addComponents(new ButtonBuilder().setCustomId(`shogi_col_${i}`).setLabel(`${9-i}`).setStyle(ButtonStyle.Secondary));
            for(let i=5;i<9;i++) r2.addComponents(new ButtonBuilder().setCustomId(`shogi_col_${i}`).setLabel(`${9-i}`).setStyle(ButtonStyle.Secondary));
            rows=[r1,r2,new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('shogi_resign').setLabel('途中退出 🚪').setStyle(ButtonStyle.Danger))];
        }
        return {embed:em,rows};
    }
    if(state.type==='chess'){
        const em=new EmbedBuilder().setTitle(`♟️ チェス ｜ ${ml}`)
            .setDescription(renderChessBoard(state.board,state.selected,state.validMoves))
            .addFields({name:'♔ 白',value:p1n,inline:true},{name:'♚ 黒',value:p2n,inline:true},{name:'手番',value:turnLabel,inline:true})
            .setColor(0xF0D9B5);
        let rows;
        if(state.phase==='select_dest'){
            const dr=[];let cr=null;
            for(const[mx,my] of (state.validMoves||[]).slice(0,20)){if(!cr||cr.components.length>=5){cr=new ActionRowBuilder();dr.push(cr);}cr.addComponents(new ButtonBuilder().setCustomId(`chess_dest_${mx}_${my}`).setLabel(`${'abcdefgh'[mx]}${8-my}`).setStyle(ButtonStyle.Primary));if(dr.length>=4)break;}
            dr.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('chess_cancel').setLabel('キャンセル').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('chess_resign').setLabel('途中退出 🚪').setStyle(ButtonStyle.Danger)));
            rows=dr;
        } else if(state.phase==='select_row'){
            const r=new ActionRowBuilder();
            for(let i=0;i<8;i++) r.addComponents(new ButtonBuilder().setCustomId(`chess_row_${i}`).setLabel(`${8-i}`).setStyle(ButtonStyle.Primary));
            rows=[r,new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('chess_cancel').setLabel('キャンセル').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('chess_resign').setLabel('途中退出 🚪').setStyle(ButtonStyle.Danger))];
        } else {
            const r=new ActionRowBuilder();
            for(let i=0;i<8;i++) r.addComponents(new ButtonBuilder().setCustomId(`chess_col_${i}`).setLabel('abcdefgh'[i]).setStyle(ButtonStyle.Secondary));
            rows=[r,new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('chess_resign').setLabel('途中退出 🚪').setStyle(ButtonStyle.Danger))];
        }
        return {embed:em,rows};
    }
    if(state.type==='othello'){
        const{b,w}=countOthello(state.board);
        const showVms=isP1Turn?state.validMoves:[];
        const em=new EmbedBuilder().setTitle(`⚫⚪ オセロ ｜ ${ml}`)
            .setDescription(renderOthelloBoard(state.board,showVms))
            .addFields({name:'⚫ 黒',value:`${p1n} (${b}個)`,inline:true},{name:'⚪ 白',value:`${p2n} (${w}個)`,inline:true},{name:'手番',value:turnLabel,inline:true})
            .setColor(0x2d7d46);
        return {embed:em,rows:buildOthelloUI(state)};
    }
    return {embed:new EmbedBuilder(),rows:[]};
}

function buildAkiEmbed(state, p1name, p2name) {
    const ml = state.mode==='local'?'対人モード':'ソロ';
    const turnName = state.turn===1?p1name:p2name;
    let desc;
    if(state.mode==='local'){
        desc = `**${turnName}** が質問に答えます\n\n**質問 ${state.qIndex+1} / ${AKI_Q.length}**\n\n${AKI_Q[state.qIndex]}`;
    } else {
        desc = `**質問 ${state.qIndex+1} / ${AKI_Q.length}**\n\n${AKI_Q[state.qIndex]}`;
    }
    return new EmbedBuilder().setTitle(`🧞 アキネーター ｜ ${ml}`).setDescription(desc).setColor(0x6A0DAD).setFooter({text:'頭の中に思い浮かべたキャラや人物を当てます！'});
}
function buildAkiRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('aki_yes').setLabel('はい ✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('aki_no').setLabel('いいえ ❌').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('aki_skip').setLabel('わからない 🤷').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('aki_resign').setLabel('途中退出 🚪').setStyle(ButtonStyle.Danger),
    );
}

// ==================== コマンドハンドラー ====================
async function handlePlayCommand(interaction) {
    const {commandName,user,channelId,guildId} = interaction;
    const opts = interaction.options;

    if(commandName==='aki'){
        const mode=opts.getString('mode')||'bot';
        const opponent=opts.getUser('opponent');

        if(mode==='local'){
            if(!opponent) return interaction.reply({content:'❌ `opponent` に対戦相手を指定してください。',...EPH});
            if(opponent.id===user.id) return interaction.reply({content:'❌ 自分自身とは対戦できません。',...EPH});
            if(opponent.bot) return interaction.reply({content:'❌ Botとは対戦できません。',...EPH});

            // 招待送信
            const inviteKey=`${guildId}_${user.id}`;
            const embed=new EmbedBuilder().setTitle('🧞 アキネーター 対人招待').setDescription(`<@${user.id}> が <@${opponent.id}> にアキネーター（対人）の招待を送りました！\n\n**ルール:** 2人で交互に「はい/いいえ/わからない」を答えながら一緒にキャラを当てます。\n\n<@${opponent.id}> は承諾しますか？（60秒以内）`).setColor(0x6A0DAD);
            const row=new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`invite_accept_${user.id}_aki`).setLabel('承諾する ✅').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`invite_decline_${user.id}_aki`).setLabel('断る ❌').setStyle(ButtonStyle.Danger),
            );
            await interaction.reply({embeds:[embed],components:[row]});
            pendingInvites.set(inviteKey,{game:'aki',inviteeId:opponent.id,channelId,userId:user.id,inviterName:user.username,inviteeName:opponent.username});
            setTimeout(()=>{if(pendingInvites.has(inviteKey)){pendingInvites.delete(inviteKey);interaction.editReply({embeds:[new EmbedBuilder().setTitle('⏰ 招待タイムアウト').setDescription('招待が期限切れになりました。').setColor(0x888888)],components:[]}).catch(()=>{});}},60000);
            return;
        }

        // ソロ
        const key=gk(channelId,user.id);
        const state=initGame('aki','bot',user.id,null,'普通');
        activeGames.set(key,state);
        const embed=buildAkiEmbed(state,user.username,'Bot');
        return interaction.reply({embeds:[embed],components:[buildAkiRow()]});
    }

    const mode=opts.getString('mode')||'bot';
    const diff=opts.getString('difficulty')||'普通';
    const opponent=opts.getUser('opponent');

    // ===== vs Bot =====
    if(mode==='bot'){
        const key=gk(channelId,user.id);
        const state=initGame(commandName,'bot',user.id,null,diff);
        activeGames.set(key,state);
        const {embed,rows}=buildAllGameUI(state,user.username,`Bot（${diff}）`);
        return interaction.reply({embeds:[embed],components:rows});
    }

    // ===== サーバー内対戦 =====
    if(mode==='local'){
        if(!opponent) return interaction.reply({content:'❌ `opponent` に対戦相手を指定してください。',...EPH});
        if(opponent.id===user.id) return interaction.reply({content:'❌ 自分自身とは対戦できません。',...EPH});
        if(opponent.bot) return interaction.reply({content:'❌ Botとの対戦は `vs Bot` モードを使ってください。',...EPH});

        const inviteKey=`${guildId}_${user.id}`;
        const embed=new EmbedBuilder()
            .setTitle(`⚔️ ${GAME_NAMES[commandName]}の対戦招待`)
            .setDescription(`<@${user.id}> が <@${opponent.id}> に **${GAME_NAMES[commandName]}** の対戦を申し込みました！\n\n<@${opponent.id}> は承諾しますか？（60秒以内）`)
            .setColor(0x3498db);
        const row=new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`invite_accept_${user.id}_${commandName}`).setLabel('承諾する ✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`invite_decline_${user.id}_${commandName}`).setLabel('断る ❌').setStyle(ButtonStyle.Danger),
        );
        await interaction.reply({embeds:[embed],components:[row]});
        pendingInvites.set(inviteKey,{game:commandName,inviteeId:opponent.id,channelId,userId:user.id,inviterName:user.username,inviteeName:opponent.username});
        setTimeout(()=>{if(pendingInvites.has(inviteKey)){pendingInvites.delete(inviteKey);interaction.editReply({embeds:[new EmbedBuilder().setTitle('⏰ 招待タイムアウト').setDescription('招待が期限切れになりました。').setColor(0x888888)],components:[]}).catch(()=>{});}},60000);
        return;
    }

    // ===== オンライン対戦 =====
    if(mode==='online'){
        const waiting=[...onlineMatches.entries()].find(([,m])=>m.game===commandName&&m.status==='waiting'&&m.p1.id!==user.id);
        if(waiting){
            const [matchId,match]=waiting;
            match.status='playing';
            match.p2={id:user.id,username:user.username,channelId,guildId};
            onlineMatches.set(matchId,match);
            const state=initGame(commandName,'online',match.p1.id,user.id,'普通');
            state.matchId=matchId;
            const key1=gk(match.p1.channelId,match.p1.id);
            const key2=gk(channelId,user.id);
            activeGames.set(key1,{...state,_myKey:key1,_partnerKey:key2});
            activeGames.set(key2,{...state,_myKey:key2,_partnerKey:key1});
            const {embed:e1,rows:r1}=buildAllGameUI(activeGames.get(key1),match.p1.username,user.username);
            const p1Ch=await interaction.client.channels.fetch(match.p1.channelId).catch(()=>null);
            if(p1Ch) p1Ch.send({content:`<@${match.p1.id}> マッチングしました！ **${user.username}** との対戦開始！`,embeds:[e1],components:r1}).catch(()=>{});
            const {embed:e2,rows:r2}=buildAllGameUI(activeGames.get(key2),match.p1.username,user.username);
            return interaction.reply({content:`マッチングしました！ **${match.p1.username}** との対戦開始！`,embeds:[e2],components:r2});
        } else {
            const matchId=`${commandName}_${Date.now()}`;
            onlineMatches.set(matchId,{game:commandName,status:'waiting',p1:{id:user.id,username:user.username,channelId,guildId}});
            const embed=new EmbedBuilder().setTitle('🌐 オンライン対戦 マッチング中...').setDescription(`**${GAME_NAMES[commandName]}** の対戦相手を探しています...\n他サーバーのユーザーが \`/${commandName} mode:オンライン対戦\` を使うとマッチングされます。`).setColor(0xf39c12);
            return interaction.reply({embeds:[embed],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`online_cancel_${matchId}`).setLabel('キャンセル').setStyle(ButtonStyle.Danger))]});
        }
    }
}

// ==================== ユーティリティ ====================
function isMyTurn(state, userId) {
    if(state.mode==='bot') return true;
    if(state.type==='chess') return (state.turn==='w')===(userId===state.p1Id);
    return (state.turn===1)===(userId===state.p1Id);
}

async function syncPartner(state) {
    if(!state._partnerKey) return;
    const partner=activeGames.get(state._partnerKey);
    if(!partner) return;
    partner.board=state.board.map(r=>Array.isArray(r)?[...r]:r);
    partner.turn=state.turn;
    if(state.type==='igo'){partner.passes=state.passes;partner.captures=[...state.captures];partner.lastMove=state.lastMove;}
    partner.phase=state.type==='othello'?null:'select';
    partner.selected=null;partner.validMoves=[];partner.selCol=null;
    if(state.type==='othello') partner.validMoves=getOthelloMoves(state.board,partner.turn===1?1:2);
}

function endGame(key, state) {
    activeGames.delete(key);
    if(state._partnerKey) activeGames.delete(state._partnerKey);
    if(state.matchId) onlineMatches.delete(state.matchId);
}

// ==================== ボタンハンドラー ====================
async function handlePlayButton(interaction) {
    const {customId,user,channelId} = interaction;
    const key=gk(channelId,user.id);

    // --- オンラインキャンセル ---
    if(customId.startsWith('online_cancel_')){
        const mid=customId.replace('online_cancel_','');
        onlineMatches.delete(mid);
        return interaction.update({embeds:[new EmbedBuilder().setTitle('🌐 マッチングキャンセル').setDescription('キャンセルしました。').setColor(0x888888)],components:[]});
    }

    // --- 招待応答 ---
    if(customId.startsWith('invite_accept_')||customId.startsWith('invite_decline_')){
        const parts=customId.split('_');
        const isAccept=parts[1]==='accept';
        const inviterId=parts[2];
        const game=parts[3];
        const inviteKey=`${interaction.guildId}_${inviterId}`;
        const invite=pendingInvites.get(inviteKey);

        if(!invite) return interaction.reply({content:'❌ この招待は無効または期限切れです。',...EPH});
        if(invite.inviteeId!==user.id) return interaction.reply({content:'❌ この招待はあなた宛てではありません。',...EPH});
        pendingInvites.delete(inviteKey);

        if(!isAccept){
            return interaction.update({embeds:[new EmbedBuilder().setTitle('❌ 対戦招待').setDescription(`<@${user.id}> が招待を断りました。`).setColor(0xe74c3c)],components:[]});
        }

        // ゲーム開始
        const key1=gk(invite.channelId,inviterId);
        const key2=gk(channelId,user.id);

        if(game==='aki'){
            // アキネーター対人
            const state=initGame('aki','local',inviterId,user.id,'普通');
            activeGames.set(key1,{...state,_myKey:key1,_partnerKey:key2});
            activeGames.set(key2,{...state,_myKey:key2,_partnerKey:key1});
            const embed=buildAkiEmbed(state,invite.inviterName,user.username);
            const row=buildAkiRow();
            // P1チャンネルに通知
            const p1Ch=await interaction.client.channels.fetch(invite.channelId).catch(()=>null);
            if(p1Ch) p1Ch.send({content:`<@${inviterId}> アキネーター対人戦が始まります！`,embeds:[buildAkiEmbed(state,invite.inviterName,user.username)],components:[buildAkiRow()]}).catch(()=>{});
            return interaction.update({embeds:[embed],components:[row]});
        }

        // 通常ゲーム
        const state=initGame(game,'local',inviterId,user.id,'普通');
        activeGames.set(key1,{...state,_myKey:key1,_partnerKey:key2});
        activeGames.set(key2,{...state,_myKey:key2,_partnerKey:key1});
        const {embed,rows}=buildAllGameUI(state,invite.inviterName,user.username);
        // P1チャンネルに通知
        const p1Ch=await interaction.client.channels.fetch(invite.channelId).catch(()=>null);
        if(p1Ch) p1Ch.send({content:`<@${inviterId}> 対戦が始まります！`,embeds:[buildAllGameUI(activeGames.get(key1),invite.inviterName,user.username).embed],components:buildAllGameUI(activeGames.get(key1),invite.inviterName,user.username).rows}).catch(()=>{});
        return interaction.update({embeds:[embed],components:rows});
    }

    const state=activeGames.get(key);
    if(!state) return interaction.reply({content:'❌ ゲームが見つかりません。コマンドで新しく始めてください。',...EPH});

    // --- 途中退出確認 ---
    const resignIds=[`igo_resign`,`shogi_resign`,`chess_resign`,`othello_resign`,`aki_resign`];
    if(resignIds.includes(customId)){
        pendingQuits.set(key,true);
        const prefix=customId.split('_')[0];
        return interaction.reply({content:'⚠️ 本当に途中退出しますか？対人戦の場合は相手の勝利になります。',components:buildConfirmQuitRow(prefix),...EPH});
    }
    // 退出確認OK
    const confirmMatch = customId.match(/^(\w+)_resign_confirm$/);
    if(confirmMatch){
        pendingQuits.delete(key);
        const winner = state.mode!=='bot' ? (user.id===state.p1Id ? state.p2Id : state.p1Id) : null;
        const winMsg = winner ? `\n<@${winner}> の勝ちです！` : '';
        endGame(key,state);
        return interaction.update({embeds:[new EmbedBuilder().setTitle('🚪 途中退出').setDescription(`<@${user.id}> が途中退出しました。${winMsg}`).setColor(0x888888)],components:[]});
    }
    // 退出キャンセル
    const cancelMatch = customId.match(/^(\w+)_resign_cancel$/);
    if(cancelMatch){
        pendingQuits.delete(key);
        return interaction.update({content:'続きをどうぞ！'});
    }

    // 対人戦ターンチェック
    if(state.mode!=='bot'&&!isMyTurn(state,user.id)){
        return interaction.reply({content:'⏳ 相手のターンです。',...EPH});
    }

    const p1name=state.mode==='bot'?user.username:`<@${state.p1Id}>`;
    const p2name=state.mode==='bot'?`Bot（${state.difficulty}）`:`<@${state.p2Id}>`;

    // ==================== アキネーター ====================
    if(state.type==='aki'){
        let ans=null;
        if(customId==='aki_yes') ans=true;
        else if(customId==='aki_no') ans=false;
        // skip → null のまま
        state.answers[state.qIndex]=ans;
        state.qIndex++;

        if(state.mode==='local'){
            state.turn=state.turn===1?2:1;
            await syncPartner(state);
            const partner=activeGames.get(state._partnerKey);
            if(partner){partner.qIndex=state.qIndex;partner.answers=[...state.answers];partner.turn=state.turn;}
        }

        if(state.qIndex>=15||state.qIndex>=AKI_Q.length){
            const guess=akiGuess(state.answers);
            endGame(key,state);
            const em=new EmbedBuilder().setTitle('🧞 アキネーター：発表！').setDescription(`あなたが思い浮かべたのは...\n\n# **${guess.name}**\n\nですね？！`).setColor(0x6A0DAD).setFooter({text:'もう一度試すには /aki を使ってください'});
            return interaction.update({embeds:[em],components:[]});
        }

        const embed=buildAkiEmbed(state,p1name,p2name);
        return interaction.update({embeds:[embed],components:[buildAkiRow()]});
    }

    // ==================== 囲碁 ====================
    if(state.type==='igo'){
        if(customId==='igo_back'){state.phase='select_col';state.selCol=null;const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.update({embeds:[embed],components:rows});}
        if(customId==='igo_pass'){
            state.passes++;
            if(state.passes>=2){endGame(key,state);return interaction.update({embeds:[new EmbedBuilder().setTitle('🟤 囲碁 終了').setDescription('両者パスにより終局です。').setColor(0x888888)],components:[]});}
            if(state.mode==='bot'){const bm=botIgoMove(state.board,2,state.difficulty);if(bm){const r=igoPlace(state.board,bm.x,bm.y,2);if(r){state.board=r.board;state.captures[1]+=r.captured;state.lastMove=[bm.x,bm.y];state.passes=0;}else state.passes++;}else state.passes++;}
            else{state.turn=state.turn===1?2:1;await syncPartner(state);}
            state.phase='select_col';state.selCol=null;
            const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.update({embeds:[embed],components:rows});
        }
        if(customId.startsWith('igo_col_')){state.selCol=parseInt(customId.split('_')[2]);state.phase='select_row';const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.update({embeds:[embed],components:rows});}
        if(customId.startsWith('igo_row_')){
            const row=parseInt(customId.split('_')[2]);
            const mc=(state.mode==='bot'||user.id===state.p1Id)?1:2;
            const r=igoPlace(state.board,state.selCol,row,mc);
            if(!r) return interaction.reply({content:'❌ そこには打てません（自殺手）。',...EPH});
            state.board=r.board;if(mc===1)state.captures[0]+=r.captured;else state.captures[1]+=r.captured;
            state.lastMove=[state.selCol,row];state.passes=0;
            if(state.mode==='bot'){const bm=botIgoMove(state.board,2,state.difficulty);if(bm){const br=igoPlace(state.board,bm.x,bm.y,2);if(br){state.board=br.board;state.captures[1]+=br.captured;state.lastMove=[bm.x,bm.y];}}}
            else{state.turn=state.turn===1?2:1;await syncPartner(state);}
            state.phase='select_col';state.selCol=null;
            const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.update({embeds:[embed],components:rows});
        }
    }

    // ==================== 将棋 ====================
    if(state.type==='shogi'){
        const myS=(state.mode==='bot'||user.id===state.p1Id)?1:2;
        if(customId==='shogi_cancel'){state.phase='select';state.selected=null;state.validMoves=[];state.selCol=null;const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.update({embeds:[embed],components:rows});}
        if(customId.startsWith('shogi_col_')){state.selCol=parseInt(customId.split('_')[2]);state.phase='select_row';const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.update({embeds:[embed],components:rows});}
        if(customId.startsWith('shogi_row_')){
            const y=parseInt(customId.split('_')[2]),x=state.selCol;
            const p=state.board[y][x];
            if(!p||p.s!==myS) return interaction.reply({content:'❌ そこにあなたの駒がありません。',...EPH});
            const moves=getShogiMoves(state.board,x,y);
            if(!moves.length) return interaction.reply({content:'❌ その駒は動けません。',...EPH});
            state.selected=[x,y];state.validMoves=moves;state.phase='select_dest';
            const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.update({embeds:[embed],components:rows});
        }
        if(customId.startsWith('shogi_dest_')){
            const [,,,tx,ty]=customId.split('_');
            const [fx,fy]=state.selected;
            const nb=state.board.map(r=>[...r]);
            const piece={...nb[fy][fx]};const itx=parseInt(tx),ity=parseInt(ty);
            const captured=nb[ity][itx];
            if(piece.s===1&&ity===0&&['歩','銀','飛','角','桂','香'].includes(piece.t)) piece.t+='+';
            else if(piece.s===2&&ity===8&&['歩','銀','飛','角','桂','香'].includes(piece.t)) piece.t+='+';
            nb[ity][itx]=piece;nb[fy][fx]=null;state.board=nb;
            if(captured?.t==='王'){endGame(key,state);return interaction.update({embeds:[new EmbedBuilder().setTitle('🎌 将棋 終了').setDescription(`🎉 <@${user.id}> の勝ちです！王将を取りました！`).setColor(0x00FF00)],components:[]});}
            if(state.mode==='bot'){
                await interaction.deferUpdate();await new Promise(r=>setTimeout(r,400));
                const bm=botShogiMove(state.board,state.difficulty);
                if(!bm){endGame(key,state);return interaction.editReply({embeds:[new EmbedBuilder().setTitle('🎌 将棋 終了').setDescription('🎉 Botが動けなくなりました。あなたの勝ちです！').setColor(0x00FF00)],components:[]});}
                const nb2=state.board.map(r=>[...r]);const bCap=nb2[bm.ty][bm.tx];nb2[bm.ty][bm.tx]={...nb2[bm.fy][bm.fx]};nb2[bm.fy][bm.fx]=null;state.board=nb2;
                if(bCap?.t==='王'){endGame(key,state);return interaction.editReply({embeds:[new EmbedBuilder().setTitle('🎌 将棋 終了').setDescription('王将を取られました...負けです。').setColor(0xFF0000)],components:[]});}
                state.phase='select';state.selected=null;state.validMoves=[];state.selCol=null;
                const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.editReply({embeds:[embed],components:rows});
            } else {
                state.turn=state.turn===1?2:1;await syncPartner(state);
                state.phase='select';state.selected=null;state.validMoves=[];state.selCol=null;
                const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.update({embeds:[embed],components:rows});
            }
        }
    }

    // ==================== チェス ====================
    if(state.type==='chess'){
        const myS=(state.mode==='bot'||user.id===state.p1Id)?'w':'b';
        if(customId==='chess_cancel'){state.phase='select';state.selected=null;state.validMoves=[];state.selCol=null;const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.update({embeds:[embed],components:rows});}
        if(customId.startsWith('chess_col_')){state.selCol=parseInt(customId.split('_')[2]);state.phase='select_row';const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.update({embeds:[embed],components:rows});}
        if(customId.startsWith('chess_row_')){
            const y=parseInt(customId.split('_')[2]),x=state.selCol;
            const p=state.board[y][x];
            if(!p||p.s!==myS) return interaction.reply({content:'❌ そこにあなたの駒がありません。',...EPH});
            const moves=getChessMoves(state.board,x,y);
            if(!moves.length) return interaction.reply({content:'❌ その駒は動けません。',...EPH});
            state.selected=[x,y];state.validMoves=moves;state.phase='select_dest';
            const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.update({embeds:[embed],components:rows});
        }
        if(customId.startsWith('chess_dest_')){
            const [,,,tx,ty]=customId.split('_');
            const [fx,fy]=state.selected;
            const nb=state.board.map(r=>[...r]);
            const piece={...nb[fy][fx]};const itx=parseInt(tx),ity=parseInt(ty);
            const cap=nb[ity][itx];nb[ity][itx]=piece;nb[fy][fx]=null;
            if(piece.t==='P'&&(ity===0||ity===7)) piece.t='Q';
            state.board=nb;
            if(cap?.t==='K'){endGame(key,state);return interaction.update({embeds:[new EmbedBuilder().setTitle('♟️ チェス 終了').setDescription(`🎉 <@${user.id}> の勝ちです！キングを取りました！`).setColor(0x00FF00)],components:[]});}
            if(state.mode==='bot'){
                await interaction.deferUpdate();await new Promise(r=>setTimeout(r,400));
                const bm=botChessMove(state.board,state.difficulty);
                if(!bm){endGame(key,state);return interaction.editReply({embeds:[new EmbedBuilder().setTitle('♟️ チェス 終了').setDescription('🎉 Botが動けなくなりました！あなたの勝ちです！').setColor(0x00FF00)],components:[]});}
                const nb2=state.board.map(r=>[...r]);const bCap=nb2[bm.ty][bm.tx];nb2[bm.ty][bm.tx]={...nb2[bm.fy][bm.fx]};nb2[bm.fy][bm.fx]=null;
                if(nb2[bm.ty][bm.tx].t==='P'&&bm.ty===7) nb2[bm.ty][bm.tx].t='Q';
                state.board=nb2;
                if(bCap?.t==='K'){endGame(key,state);return interaction.editReply({embeds:[new EmbedBuilder().setTitle('♟️ チェス 終了').setDescription('キングを取られました...負けです。').setColor(0xFF0000)],components:[]});}
                state.turn=state.turn==='w'?'b':'w';
                state.phase='select';state.selected=null;state.validMoves=[];state.selCol=null;
                const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.editReply({embeds:[embed],components:rows});
            } else {
                state.turn=state.turn==='w'?'b':'w';await syncPartner(state);
                state.phase='select';state.selected=null;state.validMoves=[];state.selCol=null;
                const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.update({embeds:[embed],components:rows});
            }
        }
    }

    // ==================== オセロ ====================
    if(state.type==='othello'){
        const myC=(state.mode==='bot'||user.id===state.p1Id)?1:2;
        if(customId==='othello_cancel'){state.phase=null;state.selCol=null;const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.update({embeds:[embed],components:rows});}
        if(customId.startsWith('othello_col_')){
            state.selCol=parseInt(customId.split('_')[2]);state.phase='select_row';
            const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.update({embeds:[embed],components:rows});
        }
        if(customId.startsWith('othello_row_')){
            const y=parseInt(customId.split('_')[2]),x=state.selCol;
            if(!state.validMoves.some(([vx,vy])=>vx===x&&vy===y)) return interaction.reply({content:'❌ そこには置けません。',...EPH});
            state.board=othelloPlace(state.board,x,y,myC);
            if(state.mode==='bot'){
                const bm=botOthelloMove(state.board,state.difficulty);
                if(bm) state.board=othelloPlace(state.board,bm[0],bm[1],2);
                state.validMoves=getOthelloMoves(state.board,1);
            } else {
                const nc=myC===1?2:1;state.turn=state.turn===1?2:1;
                const nm=getOthelloMoves(state.board,nc);
                if(!nm.length){state.turn=state.turn===1?2:1;state.validMoves=getOthelloMoves(state.board,myC);}
                else state.validMoves=nm;
                await syncPartner(state);
            }
            state.phase=null;state.selCol=null;
            const{b,w}=countOthello(state.board);
            const p1vm=getOthelloMoves(state.board,1),p2vm=getOthelloMoves(state.board,2);
            if((state.mode==='bot'&&!state.validMoves.length)||(state.mode!=='bot'&&!p1vm.length&&!p2vm.length)){
                const res=b>w?`🎉 ⚫ 黒(${b}) の勝ち！`:b<w?`⚪ 白(${w}) の勝ち！`:`引き分け！(${b}-${w})`;
                endGame(key,state);
                return interaction.update({embeds:[new EmbedBuilder().setTitle('⚫⚪ オセロ 終了').setDescription(`${renderOthelloBoard(state.board,[])}\n${res}`).setColor(0x2d7d46)],components:[]});
            }
            const{embed,rows}=buildAllGameUI(state,p1name,p2name);return interaction.update({embeds:[embed],components:rows});
        }
    }
}

module.exports = { getPlayCommands, handlePlayCommand, handlePlayButton };
