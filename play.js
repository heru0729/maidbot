/**
 * play.js — ゲームモジュール
 * 対応ゲーム: 囲碁(9x9) / 将棋 / チェス / オセロ / アキネーター
 * モード: vs Bot（難易度: 弱・普通・強） / サーバー内対戦 / オンライン対戦（サーバー跨ぎ）
 */

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    SlashCommandBuilder, MessageFlags
} = require('discord.js');

const EPH = { flags: MessageFlags.Ephemeral };

// ==================== ゲーム状態管理 ====================
const activeGames = new Map();   // key: `${channelId}_${userId}`
const onlineMatches = new Map(); // key: matchId → match info
const pendingInvites = new Map();// key: `${guildId}_${inviterId}`

function makeGameKey(channelId, userId) { return `${channelId}_${userId}`; }

const GAME_NAMES = { igo:'囲碁', shogi:'将棋', chess:'チェス', othello:'オセロ' };

// ==================== 囲碁ロジック ====================
const IGO_SIZE = 9;
const IGO_COLS = 'ABCDEFGHJ';

function createIgoBoard() {
    return Array.from({ length: IGO_SIZE }, () => Array(IGO_SIZE).fill(0));
}

function renderIgoBoard(board, lastMove) {
    const header = '　' + [...IGO_COLS].join(' ');
    const rows = board.map((row, y) => {
        const rn = String(IGO_SIZE - y).padStart(2, ' ');
        const cells = row.map((cell, x) => {
            if (lastMove && lastMove[0]===x && lastMove[1]===y) return cell===1?'⊕':'⊗';
            return cell===1?'●': cell===2?'○':'┼';
        }).join('');
        return `${rn} ${cells}`;
    }).join('\n');
    return `\`\`\`\n${header}\n${rows}\n\`\`\``;
}

function igoGetGroup(board, x, y, color, visited = new Set()) {
    const key = `${x},${y}`;
    if (visited.has(key)) return { stones:[], liberties:new Set() };
    visited.add(key);
    const group = { stones:[[x,y]], liberties:new Set() };
    for (const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const nx=x+dx, ny=y+dy;
        if (nx<0||nx>=IGO_SIZE||ny<0||ny>=IGO_SIZE) continue;
        if (board[ny][nx]===0) group.liberties.add(`${nx},${ny}`);
        else if (board[ny][nx]===color) {
            const sub = igoGetGroup(board, nx, ny, color, visited);
            group.stones.push(...sub.stones);
            for (const l of sub.liberties) group.liberties.add(l);
        }
    }
    return group;
}

function igoPlace(board, x, y, color) {
    const nb = board.map(r=>[...r]);
    nb[y][x] = color;
    const opp = color===1?2:1;
    let captured = 0;
    for (const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const nx=x+dx, ny=y+dy;
        if (nx<0||nx>=IGO_SIZE||ny<0||ny>=IGO_SIZE) continue;
        if (nb[ny][nx]===opp) {
            const g = igoGetGroup(nb, nx, ny, opp);
            if (g.liberties.size===0) for (const [sx,sy] of g.stones) { nb[sy][sx]=0; captured++; }
        }
    }
    const self = igoGetGroup(nb, x, y, color);
    if (self.liberties.size===0 && captured===0) return null;
    return { board:nb, captured };
}

function botIgoMove(board, color, difficulty) {
    const moves = [];
    for (let y=0;y<IGO_SIZE;y++) for (let x=0;x<IGO_SIZE;x++) {
        if (board[y][x]!==0) continue;
        const r = igoPlace(board, x, y, color);
        if (r) moves.push({ x, y, captured:r.captured });
    }
    if (moves.length===0) return null;
    if (difficulty==='弱') return moves[Math.floor(Math.random()*moves.length)];
    const capturing = moves.filter(m=>m.captured>0);
    if (difficulty==='普通') return capturing.length>0 ? capturing[Math.floor(Math.random()*capturing.length)] : moves[Math.floor(Math.random()*moves.length)];
    if (capturing.length>0) return capturing.sort((a,b)=>b.captured-a.captured)[0];
    const center = moves.filter(m=>m.x>=2&&m.x<=6&&m.y>=2&&m.y<=6);
    return center.length>0 ? center[Math.floor(Math.random()*center.length)] : moves[Math.floor(Math.random()*moves.length)];
}

// ==================== 将棋ロジック ====================
function createShogiBoard() {
    const B = Array.from({length:9}, ()=>Array(9).fill(null));
    B[0] = [{t:'香',s:2},{t:'桂',s:2},{t:'銀',s:2},{t:'金',s:2},{t:'王',s:2},{t:'金',s:2},{t:'銀',s:2},{t:'桂',s:2},{t:'香',s:2}];
    B[1][7]={t:'飛',s:2}; B[1][1]={t:'角',s:2};
    for (let x=0;x<9;x++) B[2][x]={t:'歩',s:2};
    B[8] = [{t:'香',s:1},{t:'桂',s:1},{t:'銀',s:1},{t:'金',s:1},{t:'王',s:1},{t:'金',s:1},{t:'銀',s:1},{t:'桂',s:1},{t:'香',s:1}];
    B[7][1]={t:'飛',s:1}; B[7][7]={t:'角',s:1};
    for (let x=0;x<9;x++) B[6][x]={t:'歩',s:1};
    return B;
}

function renderShogiBoard(board, selected, validMoves) {
    const cols='９８７６５４３２１', rowNames='一二三四五六七八九';
    const vmSet = new Set((validMoves||[]).map(([x,y])=>`${x},${y}`));
    let out = '```\n　'+[...cols].join('')+'\n';
    for (let y=0;y<9;y++) {
        out += rowNames[y]+' ';
        for (let x=0;x<9;x++) {
            const p=board[y][x];
            const isSel=selected&&selected[0]===x&&selected[1]===y;
            const isVm=vmSet.has(`${x},${y}`);
            if (!p) out += isVm?'・':'　';
            else out += isSel?`[${p.t}]`:p.t;
        }
        out += '\n';
    }
    return out+'```';
}

function getShogiMoves(board, x, y) {
    const p=board[y][x]; if (!p) return [];
    const moves=[], s=p.s, fwd=s===1?-1:1;
    const add=(nx,ny)=>{ if(nx<0||nx>=9||ny<0||ny>=9) return false; if(board[ny][nx]?.s===s) return false; moves.push([nx,ny]); return !board[ny][nx]; };
    const slide=(dx,dy)=>{ let nx=x+dx,ny=y+dy; while(add(nx,ny)){nx+=dx;ny+=dy;} };
    const t=p.t;
    if (t==='歩') add(x,y+fwd);
    else if (t==='香') { let ny=y+fwd; while(ny>=0&&ny<9){if(!add(x,ny))break;ny+=fwd;} }
    else if (t==='桂') { add(x-1,y+fwd*2); add(x+1,y+fwd*2); }
    else if (t==='銀') [[0,fwd],[1,fwd],[-1,fwd],[1,-fwd],[-1,-fwd]].forEach(([dx,dy])=>add(x+dx,y+dy));
    else if (t==='金'||['歩+','銀+','桂+','香+'].includes(t)) [[0,fwd],[1,fwd],[-1,fwd],[1,0],[-1,0],[0,-fwd]].forEach(([dx,dy])=>add(x+dx,y+dy));
    else if (t==='王') [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dx,dy])=>add(x+dx,y+dy));
    else if (t==='角') { slide(1,1);slide(1,-1);slide(-1,1);slide(-1,-1); }
    else if (t==='飛') { slide(1,0);slide(-1,0);slide(0,1);slide(0,-1); }
    else if (t==='角+') { slide(1,1);slide(1,-1);slide(-1,1);slide(-1,-1); [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy])=>add(x+dx,y+dy)); }
    else if (t==='飛+') { slide(1,0);slide(-1,0);slide(0,1);slide(0,-1); [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dx,dy])=>add(x+dx,y+dy)); }
    return moves;
}

const SHOGI_VALS = {'王':10000,'飛':9,'角':8,'金':6,'銀':5,'桂':4,'香':3,'歩':1,'飛+':12,'角+':11,'歩+':4,'銀+':6,'桂+':5,'香+':4};

function botShogiMove(board, difficulty) {
    const moves = [];
    for (let y=0;y<9;y++) for (let x=0;x<9;x++) {
        if (board[y][x]?.s!==2) continue;
        for (const [tx,ty] of getShogiMoves(board,x,y))
            moves.push({fx:x,fy:y,tx,ty,val:board[ty][tx]?(SHOGI_VALS[board[ty][tx].t]||1):0});
    }
    if (moves.length===0) return null;
    if (difficulty==='弱') return moves[Math.floor(Math.random()*moves.length)];
    const ranked = [...moves].sort((a,b)=>b.val-a.val);
    if (difficulty==='普通') return ranked[Math.floor(Math.random()*Math.min(3,ranked.length))];
    return ranked[0];
}

// ==================== チェスロジック ====================
function createChessBoard() {
    const B=Array.from({length:8},()=>Array(8).fill(null));
    const back=['R','N','B','Q','K','B','N','R'];
    for (let x=0;x<8;x++) { B[0][x]={t:back[x],s:'b'}; B[1][x]={t:'P',s:'b'}; B[6][x]={t:'P',s:'w'}; B[7][x]={t:back[x],s:'w'}; }
    return B;
}

const CHESS_EMOJIS={w:{K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙'},b:{K:'♚',Q:'♛',R:'♜',B:'♝',N:'♞',P:'♟'}};
const CHESS_VALS={K:10000,Q:9,R:5,B:3,N:3,P:1};

function renderChessBoard(board, selected, validMoves) {
    const vmSet=new Set((validMoves||[]).map(([x,y])=>`${x},${y}`));
    let out='```\n  a b c d e f g h\n';
    for (let y=0;y<8;y++) {
        out+=`${8-y} `;
        for (let x=0;x<8;x++) {
            const p=board[y][x];
            const isSel=selected&&selected[0]===x&&selected[1]===y;
            const isVm=vmSet.has(`${x},${y}`);
            if (!p) out+=isVm?'· ':((x+y)%2===0?'□ ':'■ ');
            else out+=CHESS_EMOJIS[p.s][p.t]+(isSel?'*':' ');
        }
        out+=`${8-y}\n`;
    }
    return out+'  a b c d e f g h\n```';
}

function getChessMoves(board, x, y) {
    const p=board[y][x]; if (!p) return [];
    const moves=[], s=p.s, fwd=s==='w'?-1:1, startRow=s==='w'?6:1;
    const add=(nx,ny,capOnly=false,moveOnly=false)=>{ if(nx<0||nx>=8||ny<0||ny>=8) return false; const t=board[ny][nx]; if(t?.s===s) return false; if(capOnly&&!t) return false; if(moveOnly&&t) return false; moves.push([nx,ny]); return !t; };
    const slide=(dx,dy)=>{ let nx=x+dx,ny=y+dy; while(add(nx,ny)){nx+=dx;ny+=dy;} };
    if (p.t==='P') { add(x,y+fwd,false,true); if(y===startRow&&!board[y+fwd][x]) add(x,y+fwd*2,false,true); add(x+1,y+fwd,true); add(x-1,y+fwd,true); }
    else if (p.t==='R') { slide(1,0);slide(-1,0);slide(0,1);slide(0,-1); }
    else if (p.t==='N') [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]].forEach(([dx,dy])=>add(x+dx,y+dy));
    else if (p.t==='B') { slide(1,1);slide(1,-1);slide(-1,1);slide(-1,-1); }
    else if (p.t==='Q') { slide(1,0);slide(-1,0);slide(0,1);slide(0,-1);slide(1,1);slide(1,-1);slide(-1,1);slide(-1,-1); }
    else if (p.t==='K') [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dx,dy])=>add(x+dx,y+dy));
    return moves;
}

function botChessMove(board, difficulty) {
    const moves=[];
    for (let y=0;y<8;y++) for (let x=0;x<8;x++) {
        if (board[y][x]?.s!=='b') continue;
        for (const [tx,ty] of getChessMoves(board,x,y))
            moves.push({fx:x,fy:y,tx,ty,val:board[ty][tx]?(CHESS_VALS[board[ty][tx].t]||1):0});
    }
    if (moves.length===0) return null;
    if (difficulty==='弱') return moves[Math.floor(Math.random()*moves.length)];
    const ranked=[...moves].sort((a,b)=>b.val-a.val);
    if (difficulty==='普通') return ranked[Math.floor(Math.random()*Math.min(3,ranked.length))];
    return ranked[0];
}

// ==================== オセロロジック ====================
const OTHELLO_SIZE=8;
const DIRS=[[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];

function createOthelloBoard() {
    const B=Array.from({length:OTHELLO_SIZE},()=>Array(OTHELLO_SIZE).fill(0));
    B[3][3]=2; B[3][4]=1; B[4][3]=1; B[4][4]=2;
    return B;
}

function renderOthelloBoard(board, validMoves) {
    const vmSet=new Set((validMoves||[]).map(([x,y])=>`${x},${y}`));
    const cols='ＡＢＣＤＥＦＧＨ';
    let out='```\n　'+[...cols].join('')+'\n';
    for (let y=0;y<OTHELLO_SIZE;y++) {
        out+=`${y+1}　`;
        for (let x=0;x<OTHELLO_SIZE;x++) {
            const c=board[y][x];
            out+=vmSet.has(`${x},${y}`)?'＋':c===1?'●':c===2?'○':'・';
        }
        out+='\n';
    }
    return out+'```';
}

function getOthelloMoves(board, color) {
    const opp=color===1?2:1, moves=[];
    for (let y=0;y<OTHELLO_SIZE;y++) for (let x=0;x<OTHELLO_SIZE;x++) {
        if (board[y][x]!==0) continue;
        for (const [dx,dy] of DIRS) {
            let nx=x+dx,ny=y+dy,flips=0;
            while(nx>=0&&nx<OTHELLO_SIZE&&ny>=0&&ny<OTHELLO_SIZE&&board[ny][nx]===opp){nx+=dx;ny+=dy;flips++;}
            if (flips>0&&nx>=0&&nx<OTHELLO_SIZE&&ny>=0&&ny<OTHELLO_SIZE&&board[ny][nx]===color){moves.push([x,y]);break;}
        }
    }
    return moves;
}

function othelloPlace(board, x, y, color) {
    const opp=color===1?2:1, nb=board.map(r=>[...r]);
    nb[y][x]=color;
    for (const [dx,dy] of DIRS) {
        let nx=x+dx,ny=y+dy; const flipped=[];
        while(nx>=0&&nx<OTHELLO_SIZE&&ny>=0&&ny<OTHELLO_SIZE&&nb[ny][nx]===opp){flipped.push([nx,ny]);nx+=dx;ny+=dy;}
        if (flipped.length>0&&nx>=0&&nx<OTHELLO_SIZE&&ny>=0&&ny<OTHELLO_SIZE&&nb[ny][nx]===color)
            for (const [fx,fy] of flipped) nb[fy][fx]=color;
    }
    return nb;
}

function countOthello(board) {
    let b=0,w=0; for(const row of board) for(const c of row){if(c===1)b++;else if(c===2)w++;} return {b,w};
}

function botOthelloMove(board, difficulty) {
    const moves=getOthelloMoves(board,2); if(moves.length===0) return null;
    if (difficulty==='弱') return moves[Math.floor(Math.random()*moves.length)];
    const corners=moves.filter(([x,y])=>(x===0||x===7)&&(y===0||y===7));
    if (corners.length>0) return corners[0];
    if (difficulty==='強') { const edges=moves.filter(([x,y])=>x===0||x===7||y===0||y===7); if(edges.length>0) return edges[Math.floor(Math.random()*edges.length)]; }
    return moves[Math.floor(Math.random()*moves.length)];
}

// ==================== アキネーター ====================
const AKI_QUESTIONS=[
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
const AKI_CHARACTERS=[
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

function akiScore(char, answers) {
    let s=0;
    for (let i=0;i<answers.length;i++) {
        if (answers[i]===null||char.q[i]===undefined) continue;
        s += answers[i]===char.q[i]?2:-1;
    }
    return s;
}
function akiGuess(answers) { return [...AKI_CHARACTERS].sort((a,b)=>akiScore(b,answers)-akiScore(a,answers))[0]; }

// ==================== コマンド定義 ====================
function getPlayCommands() {
    const addOpts = (cmd) => cmd
        .addStringOption(o=>o.setName('mode').setDescription('対戦モード').setRequired(false)
            .addChoices({name:'vs Bot',value:'bot'},{name:'サーバー内対戦',value:'local'},{name:'オンライン対戦（他サーバーとマッチング）',value:'online'}))
        .addStringOption(o=>o.setName('difficulty').setDescription('Bot難易度（vs Botのみ）').setRequired(false)
            .addChoices({name:'弱（ランダム）',value:'弱'},{name:'普通（バランス）',value:'普通'},{name:'強（最善手）',value:'強'}))
        .addUserOption(o=>o.setName('opponent').setDescription('対戦相手（サーバー内対戦のみ）').setRequired(false));
    return [
        addOpts(new SlashCommandBuilder().setName('igo').setDescription('囲碁をプレイします（9x9）')),
        addOpts(new SlashCommandBuilder().setName('shogi').setDescription('将棋をプレイします')),
        addOpts(new SlashCommandBuilder().setName('chess').setDescription('チェスをプレイします')),
        addOpts(new SlashCommandBuilder().setName('othello').setDescription('オセロをプレイします')),
        new SlashCommandBuilder().setName('aki').setDescription('アキネーター：頭の中のキャラを当てます'),
    ].map(c=>c.toJSON());
}

// ==================== ゲーム初期化 ====================
function initGame(type, mode, p1Id, p2Id, difficulty) {
    const base={type,mode,difficulty,p1Id,p2Id,turn:1};
    if (type==='igo') return {...base,board:createIgoBoard(),passes:0,captures:[0,0],lastMove:null,phase:'select_col',selCol:null};
    if (type==='shogi') return {...base,board:createShogiBoard(),selected:null,validMoves:[],phase:'select',selCol:null};
    if (type==='chess') return {...base,board:createChessBoard(),turn:'w',selected:null,validMoves:[],phase:'select',selCol:null};
    if (type==='othello') { const board=createOthelloBoard(); return {...base,board,validMoves:getOthelloMoves(board,1),phase:null,selCol:null}; }
}

// ==================== UI ビルダー ====================
function getModeLabel(state) {
    if (state.mode==='bot') return `vs Bot（${state.difficulty}）`;
    if (state.mode==='local') return 'サーバー内対戦';
    return 'オンライン対戦';
}

function getTurnLabel(state, p1name, p2name) {
    const isP1Turn = state.type==='chess' ? state.turn==='w' : state.turn===1;
    const p1n=p1name||'P1', p2n=p2name||(state.mode==='bot'?`Bot（${state.difficulty}）`:'P2');
    if (state.type==='chess') return isP1Turn ? `♔ ${p1n}の番` : `♚ ${p2n}の番`;
    return isP1Turn ? `${p1n}の番` : `${p2n}の番`;
}

function buildAllGameUI(state, p1name, p2name) {
    const ml=getModeLabel(state);
    const p2n=p2name||(state.mode==='bot'?`Bot（${state.difficulty}）`:'P2');
    const p1n=p1name||'P1';
    const tl=getTurnLabel(state,p1n,p2n);
    if (state.type==='igo') {
        const embed=new EmbedBuilder().setTitle(`🟤 囲碁 9×9 ｜ ${ml}`)
            .setDescription(renderIgoBoard(state.board,state.lastMove))
            .addFields({name:'● 黒',value:p1n,inline:true},{name:'○ 白',value:p2n,inline:true},{name:'手番',value:tl,inline:true},{name:'取り石',value:`黒: ${state.captures[0]}　白: ${state.captures[1]}`,inline:true})
            .setColor(0x8B4513);
        let rows;
        if (state.phase==='select_row') {
            const r1=new ActionRowBuilder(),r2=new ActionRowBuilder();
            for(let i=0;i<5;i++) r1.addComponents(new ButtonBuilder().setCustomId(`igo_row_${i}`).setLabel(`${IGO_SIZE-i}`).setStyle(ButtonStyle.Primary));
            for(let i=5;i<9;i++) r2.addComponents(new ButtonBuilder().setCustomId(`igo_row_${i}`).setLabel(`${IGO_SIZE-i}`).setStyle(ButtonStyle.Primary));
            rows=[r1,r2,new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('igo_back').setLabel('← 戻る').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('igo_pass').setLabel('パス').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('igo_resign').setLabel('投了').setStyle(ButtonStyle.Danger),
            )];
        } else {
            const r1=new ActionRowBuilder(),r2=new ActionRowBuilder();
            for(let i=0;i<5;i++) r1.addComponents(new ButtonBuilder().setCustomId(`igo_col_${i}`).setLabel([...IGO_COLS][i]).setStyle(ButtonStyle.Secondary));
            for(let i=5;i<9;i++) r2.addComponents(new ButtonBuilder().setCustomId(`igo_col_${i}`).setLabel([...IGO_COLS][i]).setStyle(ButtonStyle.Secondary));
            rows=[r1,r2,new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('igo_pass').setLabel('パス').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('igo_resign').setLabel('投了').setStyle(ButtonStyle.Danger),
            )];
        }
        return {embed,rows};
    }
    if (state.type==='shogi') {
        const embed=new EmbedBuilder().setTitle(`🎌 将棋 ｜ ${ml}`)
            .setDescription(renderShogiBoard(state.board,state.selected,state.validMoves))
            .addFields({name:'▲ 先手',value:p1n,inline:true},{name:'△ 後手',value:p2n,inline:true},{name:'手番',value:tl,inline:true})
            .setColor(0xF5DEB3);
        let rows;
        const rowNames='一二三四五六七八九'.split('');
        if (state.phase==='select_dest') {
            const destRows=[]; let curRow=null;
            for(const [mx,my] of (state.validMoves||[]).slice(0,20)) {
                if(!curRow||curRow.components.length>=5){curRow=new ActionRowBuilder();destRows.push(curRow);}
                curRow.addComponents(new ButtonBuilder().setCustomId(`shogi_dest_${mx}_${my}`).setLabel(`${9-mx}${rowNames[my]}`).setStyle(ButtonStyle.Primary));
                if(destRows.length>=4) break;
            }
            destRows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('shogi_cancel').setLabel('キャンセル').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('shogi_resign').setLabel('投了').setStyle(ButtonStyle.Danger)));
            rows=destRows;
        } else if (state.phase==='select_row') {
            const r1=new ActionRowBuilder(),r2=new ActionRowBuilder();
            for(let i=0;i<5;i++) r1.addComponents(new ButtonBuilder().setCustomId(`shogi_row_${i}`).setLabel(rowNames[i]).setStyle(ButtonStyle.Primary));
            for(let i=5;i<9;i++) r2.addComponents(new ButtonBuilder().setCustomId(`shogi_row_${i}`).setLabel(rowNames[i]).setStyle(ButtonStyle.Primary));
            rows=[r1,r2,new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('shogi_cancel').setLabel('キャンセル').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('shogi_resign').setLabel('投了').setStyle(ButtonStyle.Danger))];
        } else {
            const r1=new ActionRowBuilder(),r2=new ActionRowBuilder();
            for(let i=0;i<5;i++) r1.addComponents(new ButtonBuilder().setCustomId(`shogi_col_${i}`).setLabel(`${9-i}`).setStyle(ButtonStyle.Secondary));
            for(let i=5;i<9;i++) r2.addComponents(new ButtonBuilder().setCustomId(`shogi_col_${i}`).setLabel(`${9-i}`).setStyle(ButtonStyle.Secondary));
            rows=[r1,r2,new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('shogi_resign').setLabel('投了').setStyle(ButtonStyle.Danger))];
        }
        return {embed,rows};
    }
    if (state.type==='chess') {
        const embed=new EmbedBuilder().setTitle(`♟️ チェス ｜ ${ml}`)
            .setDescription(renderChessBoard(state.board,state.selected,state.validMoves))
            .addFields({name:'♔ 白',value:p1n,inline:true},{name:'♚ 黒',value:p2n,inline:true},{name:'手番',value:tl,inline:true})
            .setColor(0xF0D9B5);
        let rows;
        if (state.phase==='select_dest') {
            const destRows=[]; let curRow=null;
            for(const [mx,my] of (state.validMoves||[]).slice(0,20)) {
                if(!curRow||curRow.components.length>=5){curRow=new ActionRowBuilder();destRows.push(curRow);}
                curRow.addComponents(new ButtonBuilder().setCustomId(`chess_dest_${mx}_${my}`).setLabel(`${'abcdefgh'[mx]}${8-my}`).setStyle(ButtonStyle.Primary));
                if(destRows.length>=4) break;
            }
            destRows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('chess_cancel').setLabel('キャンセル').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('chess_resign').setLabel('投了').setStyle(ButtonStyle.Danger)));
            rows=destRows;
        } else if (state.phase==='select_row') {
            const r=new ActionRowBuilder();
            for(let i=0;i<8;i++) r.addComponents(new ButtonBuilder().setCustomId(`chess_row_${i}`).setLabel(`${8-i}`).setStyle(ButtonStyle.Primary));
            rows=[r,new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('chess_cancel').setLabel('キャンセル').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('chess_resign').setLabel('投了').setStyle(ButtonStyle.Danger))];
        } else {
            const r=new ActionRowBuilder();
            for(let i=0;i<8;i++) r.addComponents(new ButtonBuilder().setCustomId(`chess_col_${i}`).setLabel('abcdefgh'[i]).setStyle(ButtonStyle.Secondary));
            rows=[r,new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('chess_resign').setLabel('投了').setStyle(ButtonStyle.Danger))];
        }
        return {embed,rows};
    }
    if (state.type==='othello') {
        const {b,w}=countOthello(state.board);
        const embed=new EmbedBuilder().setTitle(`⚫ オセロ ｜ ${ml}`)
            .setDescription(renderOthelloBoard(state.board,state.turn===1?state.validMoves:[]))
            .addFields({name:'● 黒',value:`${p1n} (${b})`,inline:true},{name:'○ 白',value:`${p2n} (${w})`,inline:true},{name:'手番',value:tl,inline:true})
            .setColor(0x2d7d46);
        let rows;
        if (state.phase==='select_row') {
            const rb=new ActionRowBuilder();
            for(let i=0;i<8;i++){const ok=state.validMoves.some(([x,y])=>x===state.selCol&&y===i);rb.addComponents(new ButtonBuilder().setCustomId(`othello_row_${i}`).setLabel(`${i+1}`).setStyle(ok?ButtonStyle.Primary:ButtonStyle.Secondary).setDisabled(!ok));}
            rows=[rb,new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('othello_cancel').setLabel('キャンセル').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('othello_resign').setLabel('投了').setStyle(ButtonStyle.Danger))];
        } else {
            const r=new ActionRowBuilder();
            for(let i=0;i<8;i++){const has=state.validMoves.some(([x])=>x===i);r.addComponents(new ButtonBuilder().setCustomId(`othello_col_${i}`).setLabel('ABCDEFGH'[i]).setStyle(has?ButtonStyle.Primary:ButtonStyle.Secondary).setDisabled(!has));}
            rows=[r,new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('othello_resign').setLabel('投了').setStyle(ButtonStyle.Danger))];
        }
        return {embed,rows};
    }
    return {embed:new EmbedBuilder(),rows:[]};
}

function buildAkiUI(state) {
    const embed=new EmbedBuilder().setTitle('🧞 アキネーター').setDescription(`**質問 ${state.qIndex+1} / ${AKI_QUESTIONS.length}**\n\n${AKI_QUESTIONS[state.qIndex]}`).setColor(0x6A0DAD).setFooter({text:'頭の中に思い浮かべたキャラや人物を当てます！'});
    const row=new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('aki_yes').setLabel('はい ✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('aki_no').setLabel('いいえ ❌').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('aki_skip').setLabel('わからない 🤷').setStyle(ButtonStyle.Secondary),
    );
    return {embed,row};
}

// ==================== ゲーム開始コマンドハンドラー ====================
async function handlePlayCommand(interaction) {
    const {commandName,user,channelId,guildId} = interaction;
    const opts = interaction.options;

    if (commandName==='aki') {
        const key=makeGameKey(channelId,user.id);
        activeGames.set(key,{type:'aki',qIndex:0,answers:Array(AKI_QUESTIONS.length).fill(null)});
        const {embed,row}=buildAkiUI(activeGames.get(key));
        return interaction.reply({embeds:[embed],components:[row]});
    }

    const mode = opts.getString('mode')||'bot';
    const difficulty = opts.getString('difficulty')||'普通';
    const opponent = opts.getUser('opponent');

    // ===== vs Bot =====
    if (mode==='bot') {
        const key=makeGameKey(channelId,user.id);
        const state=initGame(commandName,'bot',user.id,null,difficulty);
        activeGames.set(key,state);
        const {embed,rows}=buildAllGameUI(state,user.username,'Bot');
        return interaction.reply({embeds:[embed],components:rows});
    }

    // ===== サーバー内対戦 =====
    if (mode==='local') {
        if (!opponent) return interaction.reply({content:'❌ `opponent` に対戦相手を指定してください。',flags:MessageFlags.Ephemeral});
        if (opponent.id===user.id) return interaction.reply({content:'❌ 自分自身とは対戦できません。',flags:MessageFlags.Ephemeral});
        if (opponent.bot) return interaction.reply({content:'❌ Botとの対戦は `vs Bot` モードを使ってください。',flags:MessageFlags.Ephemeral});

        const inviteKey=`${guildId}_${user.id}`;
        const embed=new EmbedBuilder()
            .setTitle(`⚔️ ${GAME_NAMES[commandName]}の対戦招待`)
            .setDescription(`<@${user.id}> が <@${opponent.id}> に **${GAME_NAMES[commandName]}** の対戦を申し込みました！\n\n<@${opponent.id}> は承諾しますか？\n（60秒以内に応答してください）`)
            .setColor(0x3498db);
        const row=new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`invite_accept_${user.id}_${commandName}`).setLabel('承諾する ✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`invite_decline_${user.id}_${commandName}`).setLabel('断る ❌').setStyle(ButtonStyle.Danger),
        );
        const msg=await interaction.reply({embeds:[embed],components:[row],fetchReply:true});
        pendingInvites.set(inviteKey,{game:commandName,inviteeId:opponent.id,messageId:msg.id,channelId,interactionRef:interaction});
        setTimeout(()=>{
            if (pendingInvites.has(inviteKey)) {
                pendingInvites.delete(inviteKey);
                interaction.editReply({embeds:[new EmbedBuilder().setTitle('⚔️ 対戦招待').setDescription('招待がタイムアウトしました。').setColor(0x888888)],components:[]}).catch(()=>{});
            }
        },60000);
        return;
    }

    // ===== オンライン対戦 =====
    if (mode==='online') {
        const waiting=[...onlineMatches.entries()].find(([,m])=>m.game===commandName&&m.status==='waiting'&&m.p1.id!==user.id);
        if (waiting) {
            const [matchId,match]=waiting;
            match.status='playing';
            match.p2={id:user.id,username:user.username,channelId,guildId};
            onlineMatches.set(matchId,match);

            const state=initGame(commandName,'online',match.p1.id,user.id,'普通');
            state.matchId=matchId;
            const key1=makeGameKey(match.p1.channelId,match.p1.id);
            const key2=makeGameKey(channelId,user.id);
            state._myKey=key1; state._partnerKey=key2;
            activeGames.set(key1,{...state});
            activeGames.set(key2,{...state,_myKey:key2,_partnerKey:key1});

            const {embed:e1,rows:r1}=buildAllGameUI(activeGames.get(key1),match.p1.username,user.username);
            const p1Ch=await interaction.client.channels.fetch(match.p1.channelId).catch(()=>null);
            if (p1Ch) p1Ch.send({content:`<@${match.p1.id}> マッチングしました！ **${user.username}** との対戦を開始します！`,embeds:[e1],components:r1}).catch(()=>{});

            const {embed:e2,rows:r2}=buildAllGameUI(activeGames.get(key2),match.p1.username,user.username);
            return interaction.reply({content:`マッチングしました！ **${match.p1.username}** との対戦を開始します！`,embeds:[e2],components:r2});
        } else {
            const matchId=`${commandName}_${Date.now()}`;
            onlineMatches.set(matchId,{game:commandName,status:'waiting',p1:{id:user.id,username:user.username,channelId,guildId}});
            const embed=new EmbedBuilder().setTitle('🌐 オンライン対戦 マッチング中...').setDescription(`**${GAME_NAMES[commandName]}** の対戦相手を探しています...\n他サーバーのユーザーが \`/${commandName}\` で **オンライン対戦** を選ぶとマッチングされます。`).setColor(0xf39c12);
            const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`online_cancel_${matchId}`).setLabel('キャンセル').setStyle(ButtonStyle.Danger));
            return interaction.reply({embeds:[embed],components:[row]});
        }
    }
}

// ==================== ターンチェック ====================
function isMyTurn(state, userId) {
    if (state.mode==='bot') return true;
    if (state.type==='chess') return (state.turn==='w')===(userId===state.p1Id);
    return (state.turn===1)===(userId===state.p1Id);
}

// ==================== 対人戦 盤面同期 ====================
async function syncPartner(interaction, state) {
    if (!state._partnerKey) return;
    const partner=activeGames.get(state._partnerKey);
    if (!partner) return;
    partner.board=state.board.map(r=>Array.isArray(r)?[...r]:r);
    partner.turn=state.turn;
    if (state.type==='igo'){partner.passes=state.passes;partner.captures=[...state.captures];partner.lastMove=state.lastMove;}
    partner.phase= state.type==='othello'?null:'select';
    partner.selected=null; partner.validMoves=[];
    if (state.type==='othello') partner.validMoves=getOthelloMoves(state.board,partner.turn===1?1:2);
    partner.selCol=null;
}

// ==================== ボタンハンドラー ====================
async function handlePlayButton(interaction) {
    const {customId,user,channelId} = interaction;
    const key=makeGameKey(channelId,user.id);

    // オンラインキャンセル
    if (customId.startsWith('online_cancel_')) {
        const matchId=customId.replace('online_cancel_','');
        onlineMatches.delete(matchId);
        return interaction.update({embeds:[new EmbedBuilder().setTitle('🌐 マッチングキャンセル').setDescription('マッチングをキャンセルしました。').setColor(0x888888)],components:[]});
    }

    // 招待応答
    if (customId.startsWith('invite_accept_')||customId.startsWith('invite_decline_')) {
        const parts=customId.split('_');
        const isAccept=parts[1]==='accept';
        const inviterId=parts[2];
        const game=parts[3];
        const inviteKey=`${interaction.guildId}_${inviterId}`;
        const invite=pendingInvites.get(inviteKey);
        if (!invite) return interaction.reply({content:'❌ この招待は無効または期限切れです。',flags:MessageFlags.Ephemeral});
        if (invite.inviteeId!==user.id) return interaction.reply({content:'❌ この招待はあなた宛てではありません。',flags:MessageFlags.Ephemeral});
        pendingInvites.delete(inviteKey);

        if (!isAccept) {
            return interaction.update({embeds:[new EmbedBuilder().setTitle('❌ 対戦招待').setDescription(`<@${user.id}> が招待を断りました。`).setColor(0xe74c3c)],components:[]});
        }

        const state=initGame(game,'local',inviterId,user.id,'普通');
        const key1=makeGameKey(invite.channelId,inviterId);
        const key2=makeGameKey(channelId,user.id);
        activeGames.set(key1,{...state,_myKey:key1,_partnerKey:key2});
        activeGames.set(key2,{...state,_myKey:key2,_partnerKey:key1});

        // 招待者のチャンネルに通知
        const p1Ch=await interaction.client.channels.fetch(invite.channelId).catch(()=>null);
        if (p1Ch) {
            const {embed:e1,rows:r1}=buildAllGameUI(activeGames.get(key1),`<@${inviterId}>`,user.username);
            p1Ch.send({content:`<@${inviterId}> 対戦が始まります！`,embeds:[e1],components:r1}).catch(()=>{});
        }
        const {embed:e2,rows:r2}=buildAllGameUI(activeGames.get(key2),`<@${inviterId}>`,user.username);
        return interaction.update({content:`対戦が始まります！`,embeds:[e2],components:r2});
    }

    const state=activeGames.get(key);
    if (!state) return interaction.reply({content:'❌ ゲームが見つかりません。コマンドで新しく始めてください。',flags:MessageFlags.Ephemeral});

    // 対人戦ターンチェック
    if (state.mode!=='bot' && !isMyTurn(state,user.id)) {
        return interaction.reply({content:'⏳ 相手のターンです。お待ちください。',flags:MessageFlags.Ephemeral});
    }

    // --- アキネーター ---
    if (state.type==='aki') {
        let ans=null;
        if (customId==='aki_yes') ans=true;
        else if (customId==='aki_no') ans=false;
        state.answers[state.qIndex]=ans;
        state.qIndex++;
        if (state.qIndex>=15||state.qIndex>=AKI_QUESTIONS.length) {
            const guess=akiGuess(state.answers);
            activeGames.delete(key);
            return interaction.update({embeds:[new EmbedBuilder().setTitle('🧞 アキネーター：発表！').setDescription(`あなたが思い浮かべたのは...\n\n# **${guess.name}**\n\nですね？！`).setColor(0x6A0DAD).setFooter({text:'もう一度試すには /aki を使ってください'})],components:[]});
        }
        const {embed,row}=buildAkiUI(state);
        return interaction.update({embeds:[embed],components:[row]});
    }

    // --- プレイヤー名の解決 ---
    const p1name = state.mode==='local'||state.mode==='online' ? `<@${state.p1Id}>` : (user.username);
    const p2name = state.mode==='bot' ? `Bot（${state.difficulty}）` : `<@${state.p2Id}>`;

    // ==================== 囲碁 ====================
    if (state.type==='igo') {
        if (customId==='igo_resign') {
            activeGames.delete(key); if(state._partnerKey) activeGames.delete(state._partnerKey);
            return interaction.update({embeds:[new EmbedBuilder().setTitle('🟤 囲碁 終了').setDescription(`<@${user.id}> が投了しました。`).setColor(0x888888)],components:[]});
        }
        if (customId==='igo_back') {
            state.phase='select_col'; state.selCol=null;
            const {embed,rows}=buildAllGameUI(state,p1name,p2name);
            return interaction.update({embeds:[embed],components:rows});
        }
        if (customId==='igo_pass') {
            state.passes++;
            if (state.passes>=2) {
                activeGames.delete(key); if(state._partnerKey) activeGames.delete(state._partnerKey);
                return interaction.update({embeds:[new EmbedBuilder().setTitle('🟤 囲碁 終了').setDescription('両者パスにより終局です。').setColor(0x888888)],components:[]});
            }
            if (state.mode==='bot') {
                const bm=botIgoMove(state.board,2,state.difficulty);
                if (bm) { const r=igoPlace(state.board,bm.x,bm.y,2); if(r){state.board=r.board;state.captures[1]+=r.captured;state.lastMove=[bm.x,bm.y];state.passes=0;} else state.passes++; }
                else state.passes++;
            } else { state.turn=state.turn===1?2:1; await syncPartner(interaction,state); }
            state.phase='select_col'; state.selCol=null;
            const {embed,rows}=buildAllGameUI(state,p1name,p2name);
            return interaction.update({embeds:[embed],components:rows});
        }
        if (customId.startsWith('igo_col_')) {
            state.selCol=parseInt(customId.split('_')[2]); state.phase='select_row';
            const {embed,rows}=buildAllGameUI(state,p1name,p2name);
            return interaction.update({embeds:[embed],components:rows});
        }
        if (customId.startsWith('igo_row_')) {
            const row=parseInt(customId.split('_')[2]);
            const myColor=(state.mode==='bot'||user.id===state.p1Id)?1:2;
            const r=igoPlace(state.board,state.selCol,row,myColor);
            if (!r) return interaction.reply({content:'❌ そこには打てません（自殺手）。',flags:MessageFlags.Ephemeral});
            state.board=r.board; if(myColor===1)state.captures[0]+=r.captured; else state.captures[1]+=r.captured;
            state.lastMove=[state.selCol,row]; state.passes=0;
            if (state.mode==='bot') {
                const bm=botIgoMove(state.board,2,state.difficulty);
                if (bm) { const br=igoPlace(state.board,bm.x,bm.y,2); if(br){state.board=br.board;state.captures[1]+=br.captured;state.lastMove=[bm.x,bm.y];} }
            } else { state.turn=state.turn===1?2:1; await syncPartner(interaction,state); }
            state.phase='select_col'; state.selCol=null;
            const {embed,rows}=buildAllGameUI(state,p1name,p2name);
            return interaction.update({embeds:[embed],components:rows});
        }
    }

    // ==================== 将棋 ====================
    if (state.type==='shogi') {
        const myS=(state.mode==='bot'||user.id===state.p1Id)?1:2;
        if (customId==='shogi_resign') {
            activeGames.delete(key); if(state._partnerKey) activeGames.delete(state._partnerKey);
            return interaction.update({embeds:[new EmbedBuilder().setTitle('🎌 将棋 終了').setDescription(`<@${user.id}> が投了しました。`).setColor(0x888888)],components:[]});
        }
        if (customId==='shogi_cancel') {
            state.phase='select'; state.selected=null; state.validMoves=[]; state.selCol=null;
            const {embed,rows}=buildAllGameUI(state,p1name,p2name);
            return interaction.update({embeds:[embed],components:rows});
        }
        if (customId.startsWith('shogi_col_')) {
            state.selCol=parseInt(customId.split('_')[2]); state.phase='select_row';
            const {embed,rows}=buildAllGameUI(state,p1name,p2name);
            return interaction.update({embeds:[embed],components:rows});
        }
        if (customId.startsWith('shogi_row_')) {
            const y=parseInt(customId.split('_')[2]),x=state.selCol;
            const p=state.board[y][x];
            if (!p||p.s!==myS) return interaction.reply({content:'❌ そこにあなたの駒がありません。',flags:MessageFlags.Ephemeral});
            const moves=getShogiMoves(state.board,x,y);
            if (moves.length===0) return interaction.reply({content:'❌ その駒は動けません。',flags:MessageFlags.Ephemeral});
            state.selected=[x,y]; state.validMoves=moves; state.phase='select_dest';
            const {embed,rows}=buildAllGameUI(state,p1name,p2name);
            return interaction.update({embeds:[embed],components:rows});
        }
        if (customId.startsWith('shogi_dest_')) {
            const [,,,tx,ty]=customId.split('_');
            const [fx,fy]=state.selected;
            const nb=state.board.map(r=>[...r]);
            const piece={...nb[fy][fx]};
            const itx=parseInt(tx),ity=parseInt(ty);
            const captured=nb[ity][itx];
            if (piece.s===1&&ity===0&&['歩','銀','飛','角','桂','香'].includes(piece.t)) piece.t+='+';
            else if (piece.s===2&&ity===8&&['歩','銀','飛','角','桂','香'].includes(piece.t)) piece.t+='+';
            nb[ity][itx]=piece; nb[fy][fx]=null;
            state.board=nb;
            if (captured?.t==='王') {
                activeGames.delete(key); if(state._partnerKey) activeGames.delete(state._partnerKey);
                return interaction.update({embeds:[new EmbedBuilder().setTitle('🎌 将棋 終了').setDescription(`🎉 <@${user.id}> の勝ちです！王将を取りました！`).setColor(0x00FF00)],components:[]});
            }
            if (state.mode==='bot') {
                await interaction.deferUpdate();
                await new Promise(r=>setTimeout(r,400));
                const bm=botShogiMove(state.board,state.difficulty);
                if (!bm) { activeGames.delete(key); return interaction.editReply({embeds:[new EmbedBuilder().setTitle('🎌 将棋 終了').setDescription('🎉 Botが動けなくなりました。あなたの勝ちです！').setColor(0x00FF00)],components:[]}); }
                const nb2=state.board.map(r=>[...r]);
                const bCap=nb2[bm.ty][bm.tx];
                nb2[bm.ty][bm.tx]={...nb2[bm.fy][bm.fx]}; nb2[bm.fy][bm.fx]=null;
                state.board=nb2;
                if (bCap?.t==='王') { activeGames.delete(key); return interaction.editReply({embeds:[new EmbedBuilder().setTitle('🎌 将棋 終了').setDescription('王将を取られました...負けです。').setColor(0xFF0000)],components:[]}); }
                state.phase='select'; state.selected=null; state.validMoves=[]; state.selCol=null;
                const {embed,rows}=buildAllGameUI(state,p1name,p2name);
                return interaction.editReply({embeds:[embed],components:rows});
            } else {
                state.turn=state.turn===1?2:1;
                await syncPartner(interaction,state);
                state.phase='select'; state.selected=null; state.validMoves=[]; state.selCol=null;
                const {embed,rows}=buildAllGameUI(state,p1name,p2name);
                return interaction.update({embeds:[embed],components:rows});
            }
        }
    }

    // ==================== チェス ====================
    if (state.type==='chess') {
        const myS=(state.mode==='bot'||user.id===state.p1Id)?'w':'b';
        if (customId==='chess_resign') {
            activeGames.delete(key); if(state._partnerKey) activeGames.delete(state._partnerKey);
            return interaction.update({embeds:[new EmbedBuilder().setTitle('♟️ チェス 終了').setDescription(`<@${user.id}> が投了しました。`).setColor(0x888888)],components:[]});
        }
        if (customId==='chess_cancel') {
            state.phase='select'; state.selected=null; state.validMoves=[]; state.selCol=null;
            const {embed,rows}=buildAllGameUI(state,p1name,p2name);
            return interaction.update({embeds:[embed],components:rows});
        }
        if (customId.startsWith('chess_col_')) {
            state.selCol=parseInt(customId.split('_')[2]); state.phase='select_row';
            const {embed,rows}=buildAllGameUI(state,p1name,p2name);
            return interaction.update({embeds:[embed],components:rows});
        }
        if (customId.startsWith('chess_row_')) {
            const y=parseInt(customId.split('_')[2]),x=state.selCol;
            const p=state.board[y][x];
            if (!p||p.s!==myS) return interaction.reply({content:'❌ そこにあなたの駒がありません。',flags:MessageFlags.Ephemeral});
            const moves=getChessMoves(state.board,x,y);
            if (moves.length===0) return interaction.reply({content:'❌ その駒は動けません。',flags:MessageFlags.Ephemeral});
            state.selected=[x,y]; state.validMoves=moves; state.phase='select_dest';
            const {embed,rows}=buildAllGameUI(state,p1name,p2name);
            return interaction.update({embeds:[embed],components:rows});
        }
        if (customId.startsWith('chess_dest_')) {
            const [,,,tx,ty]=customId.split('_');
            const [fx,fy]=state.selected;
            const nb=state.board.map(r=>[...r]);
            const piece={...nb[fy][fx]};
            const itx=parseInt(tx),ity=parseInt(ty);
            const cap=nb[ity][itx];
            nb[ity][itx]=piece; nb[fy][fx]=null;
            if (piece.t==='P'&&(ity===0||ity===7)) piece.t='Q';
            state.board=nb;
            if (cap?.t==='K') {
                activeGames.delete(key); if(state._partnerKey) activeGames.delete(state._partnerKey);
                return interaction.update({embeds:[new EmbedBuilder().setTitle('♟️ チェス 終了').setDescription(`🎉 <@${user.id}> の勝ちです！キングを取りました！`).setColor(0x00FF00)],components:[]});
            }
            if (state.mode==='bot') {
                await interaction.deferUpdate();
                await new Promise(r=>setTimeout(r,400));
                const bm=botChessMove(state.board,state.difficulty);
                if (!bm) { activeGames.delete(key); return interaction.editReply({embeds:[new EmbedBuilder().setTitle('♟️ チェス 終了').setDescription('🎉 Botが動けなくなりました！あなたの勝ちです！').setColor(0x00FF00)],components:[]}); }
                const nb2=state.board.map(r=>[...r]);
                const bCap=nb2[bm.ty][bm.tx];
                nb2[bm.ty][bm.tx]={...nb2[bm.fy][bm.fx]}; nb2[bm.fy][bm.fx]=null;
                if (nb2[bm.ty][bm.tx].t==='P'&&bm.ty===7) nb2[bm.ty][bm.tx].t='Q';
                state.board=nb2;
                if (bCap?.t==='K') { activeGames.delete(key); return interaction.editReply({embeds:[new EmbedBuilder().setTitle('♟️ チェス 終了').setDescription('キングを取られました...負けです。').setColor(0xFF0000)],components:[]}); }
                state.turn=state.turn==='w'?'b':'w';
                state.phase='select'; state.selected=null; state.validMoves=[]; state.selCol=null;
                const {embed,rows}=buildAllGameUI(state,p1name,p2name);
                return interaction.editReply({embeds:[embed],components:rows});
            } else {
                state.turn=state.turn==='w'?'b':'w';
                await syncPartner(interaction,state);
                state.phase='select'; state.selected=null; state.validMoves=[]; state.selCol=null;
                const {embed,rows}=buildAllGameUI(state,p1name,p2name);
                return interaction.update({embeds:[embed],components:rows});
            }
        }
    }

    // ==================== オセロ ====================
    if (state.type==='othello') {
        const myColor=(state.mode==='bot'||user.id===state.p1Id)?1:2;
        if (customId==='othello_resign') {
            activeGames.delete(key); if(state._partnerKey) activeGames.delete(state._partnerKey);
            return interaction.update({embeds:[new EmbedBuilder().setTitle('⚫ オセロ 終了').setDescription(`<@${user.id}> が投了しました。`).setColor(0x888888)],components:[]});
        }
        if (customId==='othello_cancel') {
            state.phase=null; state.selCol=null;
            const {embed,rows}=buildAllGameUI(state,p1name,p2name);
            return interaction.update({embeds:[embed],components:rows});
        }
        if (customId.startsWith('othello_col_')) {
            state.selCol=parseInt(customId.split('_')[2]); state.phase='select_row';
            const {embed,rows}=buildAllGameUI(state,p1name,p2name);
            return interaction.update({embeds:[embed],components:rows});
        }
        if (customId.startsWith('othello_row_')) {
            const y=parseInt(customId.split('_')[2]),x=state.selCol;
            if (!state.validMoves.some(([vx,vy])=>vx===x&&vy===y)) return interaction.reply({content:'❌ そこには置けません。',flags:MessageFlags.Ephemeral});
            state.board=othelloPlace(state.board,x,y,myColor);
            if (state.mode==='bot') {
                const bm=botOthelloMove(state.board,state.difficulty);
                if (bm) state.board=othelloPlace(state.board,bm[0],bm[1],2);
                state.validMoves=getOthelloMoves(state.board,1);
            } else {
                const nextColor=myColor===1?2:1;
                state.turn=state.turn===1?2:1;
                const nextMoves=getOthelloMoves(state.board,nextColor);
                if (nextMoves.length===0) { state.turn=state.turn===1?2:1; state.validMoves=getOthelloMoves(state.board,myColor); }
                else state.validMoves=nextMoves;
                await syncPartner(interaction,state);
            }
            state.phase=null; state.selCol=null;
            const {b,w}=countOthello(state.board);
            const p1vm=getOthelloMoves(state.board,1), p2vm=getOthelloMoves(state.board,2);
            if ((state.mode==='bot'&&state.validMoves.length===0)||(state.mode!=='bot'&&p1vm.length===0&&p2vm.length===0)) {
                const res=b>w?`🎉 黒(${b})の勝ち！`:b<w?`○ 白(${w})の勝ち！`:`引き分け！(${b}-${w})`;
                activeGames.delete(key); if(state._partnerKey) activeGames.delete(state._partnerKey);
                return interaction.update({embeds:[new EmbedBuilder().setTitle('⚫ オセロ 終了').setDescription(`${renderOthelloBoard(state.board,[])}\n${res}`).setColor(0x2d7d46)],components:[]});
            }
            const {embed,rows}=buildAllGameUI(state,p1name,p2name);
            return interaction.update({embeds:[embed],components:rows});
        }
    }
}

module.exports = { getPlayCommands, handlePlayCommand, handlePlayButton };
