"use strict";

onmessage = function(e) {
  const { subject } = e.data;

  switch (subject) {
    case undefined:
    case null:
      break;
    case "sMovementUpdate":
      const { entities, global, dt } = e.data;
      sMovementUpdate(entities, global, dt);
      break;
    case "sCirclePre":
      const { entities, global } = e.data;
      sCirclePre(entities, global);
      break;
    case "sMovementUpdate":
      const { entities, global, dt } = e.data;
      sCircleUpdate(entities, global, dt);
      break;
    case "sMovementPost":
      const { entities, global, int } = e.data;
      sCirclePost(entities, global, int);
      break;
    case "sRenderPost":
      const { entities, global, int } = e.data;
      sRenderPost(entities, global, int);
      break;
    default:
      break;
  }
}

function sCirclePre(entities, _global) {
  entities.forEach((entity) => {
    const intersecting = entity.Intersecting;
    intersecting.points.length = 0;
  });
}

function sCircleUpdate(entities, _global, _dt) {
  entities.forEach((entity, idx) => {
    for (let j = idx + 1; j < entities.length; j++) {
      const entityB = entities[j];
      const intersect = intersection(entity, entityB);
      if (intersect !== false) {
        const intersecting = entity.Intersecting;
        intersecting.points.push(intersect);
      }
    }
  });
}

function sCirclePost(entities, global, _int) {
  const canvas = global.Buffer;
  canvas.ctx.fillStyle = "black";
  canvas.ctx.fillRect(0, 0, canvas.width, canvas.height);

  entities.forEach((entity) => {
    const circle = entity.Circle;
    const position = entity.Position;
    canvas.ctx.beginPath();
    canvas.ctx.arc(
      position.x,
      position.y,
      circle.radius,
      0,
      2 * Math.PI,
      false
    );
    canvas.ctx.lineWidth = 1;
    canvas.ctx.strokeStyle = "#fff";
    canvas.ctx.stroke();

    let intersect = entity.Intersecting;
    canvas.ctx.strokeStyle = "#ff9";
    canvas.ctx.lineWidth = 2;
    canvas.ctx.fillStyle = "#fff";
    for (let j = 0; j < intersect.points.length; j++) {
      const points = intersect.points[j];
      fillCircle(canvas.ctx, points[0], points[1], 3);
      fillCircle(canvas.ctx, points[2], points[3], 3);
      drawLine(canvas.ctx, points[0], points[1], points[2], points[3]);
    }
  });
}

function sMovementUpdate(entities, global, dt) {
  const canvas = global.Canvas;
  const demo = global.Demo;
  const multiplier = demo.speedMultiplier;
  entities.forEach((entity) => {
    const position = entity.Position;
    const acceleration = entity.Acceleration;
    const velocity = entity.Velocity;
    position.x += velocity.x * acceleration.x * dt * multiplier;
    position.y += velocity.y * acceleration.y * dt * multiplier;
    if (acceleration.x > 1) acceleration.x -= dt * multiplier;
    if (acceleration.y > 1) acceleration.y -= dt * multiplier;
    if (acceleration.x < 1) acceleration.x = 1;
    if (acceleration.y < 1) acceleration.y = 1;

    const circle = entity.Circle;
    if ((position.y + circle.radius) < 0) position.y = canvas.height + circle.radius;
    if ((position.y - circle.radius) > canvas.height) position.y = -circle.radius;
    if ((position.x - circle.radius) > canvas.width) position.x = 0;
    if ((position.x + circle.radius) < 0) position.x = canvas.width;
  });
}

function sRenderPost(_entities, global, _int) {
    const buffer = global.Buffer;
    const canvas = global.Canvas;
    const ctx = canvas.ctx;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buffer.ctx.canvas, 0, 0, canvas.width, canvas.height);
}
