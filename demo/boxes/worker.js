const drawCircle = (ctx, x, y) => {
  ctx.fillStyle = "#888";
  ctx.beginPath();
  ctx.arc(x, y, SHAPE_HALF_SIZE, 0, TAU, false);
  ctx.fill();
  ctx.strokeStyle = "#222";
  ctx.stroke();
}

const drawBox = (ctx, x, y) => {
  ctx.beginPath();
  ctx.rect(x - SHAPE_HALF_SIZE, y - SHAPE_HALF_SIZE, SHAPE_SIZE, SHAPE_SIZE);
  ctx.fillStyle= "#f28d89";
  ctx.fill();
  ctx.strokeStyle = "#800904";
  ctx.stroke();
}

const drawSpecial = (ctx, x, y) => {
  ctx.save();
  ctx.fillStyle= "yellow";
  ctx.strokeStyle = "black";
  ctx.beginPath();
  ctx.translate(x, y);
  ctx.moveTo(0, 0 - 5);
  for (let i = 0; i < 5; i++) {
    const t = Math.PI / 5;
    ctx.rotate(t);
    ctx.lineTo(0, 0 - (5 * 5));
    ctx.rotate(t);
    ctx.lineTo(0, 0 - 5);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

onmessage = function(evt) {
  const { canvas, x, y, shape } = evt.data;
  const ctx = canvas.getContent("2d", { alpha: false, desynchronized: true })

  function render() {
    if (shape === 0) {
      drawBox(ctx, x, y);
    } else if (shape === 1) {
      drawCircle(ctx, x, y);
    } else {
      drawSpecial(ctx, x, y);
    }
  }

  requestAnimationFrame(render);
};
