const { createCanvas } = require('canvas');

/**
 * 株式・仮想通貨の価格チャートをBufferで生成
 * @param {number[]} history - 価格履歴配列
 * @param {string} label     - チャートタイトル（例: "BTC" や "テック社"）
 * @param {string} color     - メインカラー（例: '#57f287'）
 * @returns {Buffer} PNG画像のBuffer
 */
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

    const data = history.slice(-40); // 最大40件
    const minVal = Math.min(...data);
    const maxVal = Math.max(...data);
    const range = maxVal - minVal || 1;

    const toX = (i) => PAD.left + (i / (data.length - 1)) * chartW;
    const toY = (v) => PAD.top + chartH - ((v - minVal) / range) * chartH;

    // グリッド線
    ctx.strokeStyle = '#3a3d44';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = PAD.top + (chartH / 4) * i;
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + chartW, y);
        ctx.stroke();
    }

    // グラデーション塗りつぶし
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + chartH);
    grad.addColorStop(0, color + '88');
    grad.addColorStop(1, color + '00');
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(data[0]));
    for (let i = 1; i < data.length; i++) ctx.lineTo(toX(i), toY(data[i]));
    ctx.lineTo(toX(data.length - 1), PAD.top + chartH);
    ctx.lineTo(toX(0), PAD.top + chartH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 折れ線
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(data[0]));
    for (let i = 1; i < data.length; i++) ctx.lineTo(toX(i), toY(data[i]));
    ctx.stroke();

    // 最新値の点
    const lastX = toX(data.length - 1);
    const lastY = toY(data[data.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Y軸ラベル（価格）
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const val = minVal + (range / 4) * (4 - i);
        const y = PAD.top + (chartH / 4) * i;
        const label2 = val < 1 ? val.toFixed(3) : val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val.toFixed(1);
        ctx.fillText(label2, PAD.left - 8, y + 4);
    }

    // X軸ラベル（件数）
    ctx.textAlign = 'center';
    ctx.fillText('古', PAD.left, H - 8);
    ctx.fillText('新', PAD.left + chartW, H - 8);

    // タイトル
    const last = data[data.length - 1];
    const first = data[0];
    const pct = ((last - first) / first * 100).toFixed(2);
    const arrow = last >= first ? '▲' : '▼';
    const arrowColor = last >= first ? '#57f287' : '#ff4757';

    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, PAD.left, 24);

    ctx.font = '13px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = arrowColor;
    ctx.fillText(`${arrow} ${Math.abs(parseFloat(pct))}%`, W - PAD.right, 24);

    return canvas.toBuffer('image/png');
}

module.exports = { buildPriceChart };
