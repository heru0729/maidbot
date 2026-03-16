const { createCanvas } = require('canvas');

function buildPriceChart(history, label, color = '#5865f2') {
    const W = 600, H = 300;
    const PAD = { top: 40, right: 30, bottom: 50, left: 70 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // 背景
    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(0, 0, W, H);

    if (!history || history.length < 2) {
        ctx.fillStyle = '#aaaaaa';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('データが不足しています', W / 2, H / 2);
        return canvas.toBuffer('image/png');
    }

    const data = history.slice(-30);
    const minVal = Math.min(...data) * 0.98;
    const maxVal = Math.max(...data) * 1.02;
    const range = maxVal - minVal || 1;

    const barW = Math.max(2, Math.floor(chartW / data.length) - 2);
    const toX = (i) => PAD.left + Math.floor((i / data.length) * chartW);
    const toY = (v) => PAD.top + chartH - Math.floor(((v - minVal) / range) * chartH);

    // グリッド線
    ctx.strokeStyle = '#3a3d44';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = PAD.top + (chartH / 4) * i;
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + chartW, y);
        ctx.stroke();
    }

    // 棒グラフ描画
    const upColor = '#57f287';
    const downColor = '#ff4757';
    for (let i = 0; i < data.length; i++) {
        const x = toX(i);
        const y = toY(data[i]);
        const baseY = toY(minVal);
        const barH = Math.max(1, baseY - y);
        const isUp = i === 0 || data[i] >= data[i - 1];
        ctx.fillStyle = isUp ? upColor : downColor;
        ctx.fillRect(x, y, barW, barH);
    }

    // Y軸ラベル
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const val = minVal + (range / 4) * (4 - i);
        const y = PAD.top + (chartH / 4) * i;
        const txt = val < 1 ? val.toFixed(3) : val >= 10000 ? (val / 1000).toFixed(1) + 'k' : val.toFixed(1);
        ctx.fillText(txt, PAD.left - 6, y + 4);
    }

    // X軸ラベル
    ctx.textAlign = 'center';
    ctx.fillStyle = '#888888';
    ctx.font = '10px sans-serif';
    ctx.fillText('← 古', PAD.left + 20, H - 8);
    ctx.fillText('新 →', PAD.left + chartW - 20, H - 8);

    // タイトル・変化率
    const last = data[data.length - 1];
    const first = data[0];
    const pct = ((last - first) / Math.abs(first) * 100).toFixed(2);
    const isPositive = last >= first;
    const arrow = isPositive ? '▲' : '▼';

    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, PAD.left, 26);

    ctx.font = '13px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = isPositive ? '#57f287' : '#ff4757';
    ctx.fillText(`${arrow} ${Math.abs(parseFloat(pct))}%`, W - PAD.right, 26);

    return canvas.toBuffer('image/png');
}

module.exports = { buildPriceChart };
