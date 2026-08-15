const dt = 16;
let angle = 0;
let angleVel = 0;
let lastX = 0;

function update(x) {
   let targetAngle = (x - lastX) * -0.1; 
   let force = targetAngle - angle;
   angleVel += force * 0.1;
   angleVel *= 0.9;
   angle += angleVel;
   lastX = x;
   console.log(angle);
}
update(10);
update(20);
update(30);
update(30);
update(30);
update(30);
