const { createCanvas } = require('canvas');

function buildPriceChart(ohlcOrHistory, label, color = '#5865f2') {
    const W = 620, H = 320;
    const PAD = { top: 48, right: 30, bottom: 44, left: 80 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#1e2124';
    ctx.fillRect(0, 0, W, H);

    let data;
    if (Array.isArray(ohlcOrHistory) && ohlcOrHistory.length > 0 && typeof ohlcOrHistory[0] === 'object' && 'o' in ohlcOrHistory[0]) {
        data = ohlcOrHistory.slice(-40);
    } else if (Array.isArray(ohlcOrHistory) && ohlcOrHistory.length > 1) {
        const arr = ohlcOrHistory.slice(-40);
        data = arr.map((c, i) => {
            const o = i > 0 ? arr[i - 1] : c;
            const noise = Math.abs(c) * 0.005;
            return { o, h: Math.max(o, c) + noise, l: Math.min(o, c) - noise, c };
        });
    } else {
        ctx.fillStyle = '#888';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('データが不足しています', W / 2, H / 2);
        return canvas.toBuffer('image/png');
    }

    const allHighs = data.map(d => d.h);
    const allLows  = data.map(d => d.l);
    const minVal = Math.min(...allLows);
    const maxVal = Math.max(...allHighs);
    const range  = maxVal - minVal || Math.abs(minVal) * 0.1 || 0.001;
    const pad    = range * 0.06;
    const vMin   = minVal - pad;
    const vMax   = maxVal + pad;
    const vRange = vMax - vMin;

    const toX = (i) => PAD.left + (i + 0.5) * (chartW / data.length);
    const toY = (v) => PAD.top + chartH - ((v - vMin) / vRange) * chartH;

    // グリッド
    ctx.strokeStyle = '#2d3035';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = PAD.top + (chartH / 5) * i;
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + chartW, y); ctx.stroke();
    }

    const candleW = Math.max(2, Math.floor(chartW / data.length) - 2);

    for (let i = 0; i < data.length; i++) {
        const { o, h, l, c } = data[i];
        const isUp = c >= o;
        const col = isUp ? '#26a69a' : '#ef5350';
        ctx.fillStyle = col;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;

        const x = toX(i);
        const yO = toY(o), yC = toY(c), yH = toY(h), yL = toY(l);
        const bodyH = Math.max(1, Math.abs(yO - yC));
        const bodyY = Math.min(yO, yC);

        // ヒゲ
        ctx.beginPath(); ctx.moveTo(x, yH); ctx.lineTo(x, bodyY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, bodyY + bodyH); ctx.lineTo(x, yL); ctx.stroke();

        // ボディ
        ctx.fillRect(x - candleW / 2, bodyY, candleW, bodyH);
    }

    // Y軸ラベル（小数点対応）
    ctx.fillStyle = '#9ea3aa';
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
        const val = vMin + (vRange / 5) * (5 - i);
        const y = PAD.top + (chartH / 5) * i;
        let txt;
        if (val < 0.001)     txt = val.toFixed(6);
        else if (val < 0.01) txt = val.toFixed(5);
        else if (val < 0.1)  txt = val.toFixed(4);
        else if (val < 1)    txt = val.toFixed(3);
        else if (val < 1000) txt = val.toFixed(2);
        else                 txt = (val / 1000).toFixed(1) + 'k';
        ctx.fillText(txt, PAD.left - 6, y + 4);
    }

    // X軸
    ctx.textAlign = 'center';
    ctx.fillStyle = '#555';
    ctx.font = '10px sans-serif';
    ctx.fillText('← 古', PAD.left + 24, H - 6);
    ctx.fillText('新 →', PAD.left + chartW - 24, H - 6);

    // タイトル・変化率
    const first = data[0].o, last = data[data.length - 1].c;
    const pct = first > 0 ? ((last - first) / first * 100) : 0;
    const isPos = last >= first;

    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e0e0e0';
    ctx.fillText(label, PAD.left, 28);

    let priceStr;
    if (last < 0.001)     priceStr = last.toFixed(6);
    else if (last < 0.01) priceStr = last.toFixed(5);
    else if (last < 0.1)  priceStr = last.toFixed(4);
    else if (last < 1)    priceStr = last.toFixed(3);
    else                  priceStr = last.toFixed(2);

    ctx.font = '13px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = isPos ? '#26a69a' : '#ef5350';
    ctx.fillText(`${priceStr}  ${isPos ? '▲' : '▼'} ${Math.abs(pct).toFixed(2)}%`, W - PAD.right, 28);

    return canvas.toBuffer('image/png');
}

module.exports = { buildPriceChart };
