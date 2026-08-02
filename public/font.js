var canvas = document.getElementById('font');
var ctx = canvas.getContext('2d');
// Builds CLIENT.General.drawTank et al. (plan.md A5) - safe to call here since it only builds
// closures/off-screen canvases, nothing that needs the game's own Run() state.
CLIENT.initRender();
window.onresize = resize;
function resize() {
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
}

const C = {
	"green": "#36e28f",
	"dkgreen": "#33ac72",
	"red": "#e45548",
	"dkred": "#a1473e",
	"gray": "#8e8ca5",
	"dkgray": "#676480",
	"Grid": "#d8d8d8",
	"dkGrid": "#cccccc",
	"square": "#ccccb2",
	"dksquare": "#a3a38e",
	"trian": "#c8b5b8",
	"dktrian": "#a58c90",
	"penta": "#b2b2cc",
	"dkpenta": "#8686ab"
};
var State = 'ffa';
var LW = 4;
var toState = 'entry';
var open = 1;
var toOpen = 1;
var T = 0;
var animated = 1;

function loop() {
	///
	toOpen += (open - toOpen) * 0.06;
	if (animated) {
		T += 1;
	}
	///
	if (State != toState) {
		if (toOpen < 1.01) {
			open = 1.03;
		} else {
			toState = State;
		}
	} else {
		open = 0;
	}

	draw()
	requestAnimationFrame(loop);
}
function draw() {
	ctx.filter = 'none';
	ctx.globalCompositeOperation = 'source-over';
	ctx.globalAlpha = 1;
	ctx.translate(-Width / 2, -Height / 2);
	var Width = window.innerWidth;
	var Height = window.innerHeight;
	ctx.clearRect(0, 0, Width, Height);
	ctx.fillStyle = C.Grid;
	ctx.fillRect(0, 0, Width, Height);
	var tilesize = 24;
	switch (State) {
		case 'entry': {

		} break;
	}
	/// GRID ///
	{
		ctx.lineWidth = 1;
		for (let i = (Width / 2) % tilesize; i <= Width; i += tilesize) {
			ctx.beginPath();
			ctx.moveTo(i, 0);
			ctx.lineTo(i, Height);
			ctx.strokeStyle = C.dkGrid;
			ctx.LineWidth = 1;
			ctx.stroke();
		}
		for (let j = (Height / 2) % tilesize; j <= Height; j += tilesize) {
			ctx.beginPath();
			ctx.moveTo(0, j);
			ctx.lineTo(Width, j);
			ctx.strokeStyle = C.dkGrid;
			ctx.LineWidth = 1;
			ctx.stroke();
		}
	}
	/// OBJ ///
	ctx.translate(Width / 2, Height / 2)
	{
		///left
		tank(-400 + Math.sin(T / 220) * 30, -200 + Math.sin(T / 350) * 30, Math.sin(T / 140) * 15 + 30, 38, 'Hybrid', [C.red, C.dkred]);
		tank(-500 + Math.cos((T + 20) / 180) * 30, 100 + Math.sin(T / 350) * 20, Math.sin((T + 1) / 170) * 25 - 40, 30, 'Twin', [C.red, C.dkred]);
		tank(-250 + Math.sin((T + 21) / 150) * 40, 300 + Math.sin((T + 3) / 220) * 10, Math.sin((T + 1) / 170) * 30 - 180, 25, 'Basic', [C.red, C.dkred]);

		obj(-220 + Math.cos(T / 510) * 10, -370 + Math.sin(T / 500) * 20, (-T + 4) / 9, 'triangle');
		obj(-500 + Math.sin(T / 400) * 20, -220 - Math.sin(0.1 + T / 490) * 10, 20 - T / 9, 'square');
		obj(-400 - Math.cos(T / 500) * 20, -100 + Math.cos(T / 500) * 20, T / 9, 'square');
		obj(-460 + Math.sin(-7 + T / 500) * 20, -90 - Math.sin(T / 490) * 10, (-T - 50) / 9, 'square');
		obj(-560 + Math.sin(1.6 + T / 400) * 20, -110 - Math.sin(0.1 + T / 490) * 10, (13 + T - 2) / 9, 'square');
		obj(-680 + Math.sin(0.5 + T / 400) * 20, -0 + Math.sin(0.1 + T / 490) * 10, (19 + T - 2) / 9, 'pentagon');
		obj(-490 - Math.cos(T / 500) * 20, -10 - Math.sin(T / 550) * 15, (-T + 1) / 9, 'triangle');
		obj(-280 + Math.sin(T / 500) * 15, -250 - Math.sin(T / 600) * 8, (T + 0.3) / 9, 'square');
		obj(-240 - Math.cos(T / 600) * 20, 50 - Math.cos(T / 500) * 10, (-T + 1.5) / 10, 'pentagon');
		obj(-380 + Math.sin(T / 450) * 10, 250 - Math.sin(T / 510) * 8, (T + 0.5) / 9, 'square');
		obj(-520 - Math.cos(T / 350) * 8, 320 - Math.sin(T / 500) * 15, (-T - 1) / 9, 'square');
		obj(-450 + Math.sin(T / 400) * 10, 380 + Math.sin(T / 560) * 20, (-T + 40) / 9, 'square');
		obj(-430 + Math.sin(0.8 - T / 450) * 15, 300 - Math.sin(2 - T / 400) * 8, (T + 2.5) / 9, 'triangle');
		obj(-170 - Math.sin(T / 450) * 30, 345 - Math.cos(-T / 520) * 10, (-T + 3.5) / 9, 'square');
		obj(-40 + Math.sin(T / 450) * 30, 370 - Math.sin(T / 510) * 10, (-T - 2) / 9, 'triangle');
		obj(-650 + Math.sin(T / 450) * 30, 380 + Math.sin(T / 510) * 10, (T - 200) / 9, 'triangle');

		bull(-250 - Math.sin(0.2 + T / 80) * 25, -100 - Math.sin(0.2 + T / 80) * 14, 40, [C.red, C.dkred]);
		bull(-360 + Math.sin(T / 100) * 10, 15 - Math.sin(T / 100) * 10, 32, [C.red, C.dkred]);
		bull(-350 + Math.sin(0.2 + T / 100) * 10, -50 - Math.sin(0.2 + T / 100) * 8, 32, [C.red, C.dkred]);
		bull(-410 + Math.sin(0.5 + T / 100) * 10, 45 - Math.sin(.5 + T / 100) * 12, 32, [C.red, C.dkred]);
		bull(-630 + Math.sin(0.2 + T / 90) * 17, 100 - Math.sin(0.2 + T / 90) * 20, 35, [C.red, C.dkred]);
		bull(-680 + Math.sin(-0.2 + T / 90) * 20, 200 - Math.sin(-0.2 + T / 90) * 17, 35, [C.red, C.dkred]);
		bull(-600 + Math.sin(-0.8 + T / 90) * 25, 270 - Math.sin(-0.8 + T / 90) * 8, 35, [C.red, C.dkred]);
		bull(-715 + Math.sin(-1.4 + T / 90) * 25, 330 - Math.sin(-1.4 + T / 90) * 8, 35, [C.red, C.dkred]);
		bull(-360 + Math.sin(0.5 + T / 100) * 22, 300 + Math.sin(.5 + T / 100) * 5, 28, [C.red, C.dkred]);
		bull(-400 + Math.sin(0.2 + T / 100) * 22, 320 - Math.sin(.2 + T / 100) * 4, 28, [C.red, C.dkred]);
		bull(-300 + Math.sin(1 + T / 100) * 12, 250 + Math.sin(.8 + T / 100) * 15, 28, [C.red, C.dkred]);
		///right
		tank(450 + Math.sin(T / 200) * 17, -250 - Math.cos(0.1 + T / 220) * 20, -T / 9, 32, 'Octo Tank', [C.red, C.dkred]);
		tank(290 + Math.cos(0.1 - T / 200) * 10, -50 - Math.cos(0.1 + T / 220) * 10, Math.sin(T / 200) * 10 + 20, 32, 'Flank Guard', [C.red, C.dkred]);
		tank(350 + Math.sin(T / 130) * 20, 320 - Math.sin(T / 130) * 15, -Math.cos(T / 130) * 10 - 40, 32, 'Destroyer', [C.red, C.dkred]);

		obj(40 - Math.sin(2 - T / 400) * 20, -385 - Math.cos(0.1 + T / 390) * 10, 200 - T / 9, 'square');
		obj(610 + Math.sin(T / 400) * 20, -220 - Math.cos(0.1 - T / 490) * 10, 20 + T / 9, 'square');
		obj(640 + Math.cos(T / 500) * 10, -150 - Math.sin(0.5 + T / 500) * 12, 60 - T / 9, 'square');
		obj(740 - Math.sin(1.3 + T / 500) * 10, -130 - Math.sin(0.5 + T / 520) * 20, T / 9, 'square');
		obj(180 + Math.sin(0.5 - T / 500) * 10, -280 + Math.sin(0.5 + T / 500) * 12, 60 - T / 9, 'pentagon');
		obj(660 - Math.cos(0.2 + T / 470) * 12, -60 - Math.cos(2 - T / 190) * 15, 20 + T / 9, 'triangle');
		obj(460 - Math.cos(4 + T / 490) * 20, 0 - Math.sin(0.5 + T / 520) * 6, 100 - T / 9, 'square');
		obj(430 + Math.sin(1.5 - T / 510) * 15, 60 + Math.sin(5 + T / 510) * 15, -30 - T / 9, 'square');
		obj(360 + Math.cos(1 - T / 510) * 18, 90 - Math.cos(5 + T / 490) * 20, T / 9, 'triangle');
		obj(210 + Math.sin(-T / 500) * 15, 120 + Math.sin(5 + T / 480) * 15, 90 - T / 9, 'square');
		obj(350 + Math.sin(-T / 500) * 15, 220 + Math.sin(5 + T / 480) * 15, 90 - T / 9, 'square');
		obj(570 - Math.sin(T / 480) * 21, 150 - Math.cos(5 + T / 480) * 15, 20 - T / 9, 'pentagon');

		bull(430 - Math.sin(.5 + T / 100) * 10, -350 - Math.sin(.5 + T / 100) * 20, 39, [C.red, C.dkred]);
		bull(300 - Math.sin(1.5 + T / 100) * 25, -300 - Math.sin(1.5 + T / 100) * 10, 39, [C.red, C.dkred]);
		bull(320 - Math.sin(T / 100) * 25, -200 + Math.sin(T / 100) * 10, 39, [C.red, C.dkred]);
		bull(620 - Math.sin(2 - T / 100) * 25, -320 + Math.sin(2 - T / 100) * 10, 39, [C.red, C.dkred]);
		bull(570 - Math.sin(3 - T / 100) * 20, -160 - Math.sin(3 - T / 100) * 15, 39, [C.red, C.dkred]);
		bull(500 - Math.sin(4 - T / 100) * 10, -110 - Math.sin(4 - T / 100) * 22, 39, [C.red, C.dkred]);
		drone(380 - Math.sin(T / 100) * 20, -10 - Math.sin(T / 100) * 15, Math.cos(T / 100) * 20 - 110, 20, [C.red, C.dkred]);
		drone(300 - Math.sin(T / 100) * 12, -150 + Math.sin(T / 100) * 20, -Math.sin(T / 100) * 15 - 170, 20, [C.red, C.dkred]);
		bull(550 - Math.sin(5 - T / 100) * 8, -20 - Math.sin(4 - T / 100) * 24, 39, [C.red, C.dkred]);
		bull(470 - Math.sin(T / 130) * 24, 220 + Math.sin(T / 130) * 17, 64, [C.red, C.dkred]);
	}
	/// DOORS ///
	ctx.translate(-Width / 2, -Height / 2);
	//ctx.filter = 'drop-shadow(0 0 16px rgba(0,0,0,0.3))'
	switch (toState) {
		case 'tag': {
			// Just a white circle running around the screen's own border - simplified down from
			// the punch-a-hole approach (rect + evenodd) after that turned into a real bug (a
			// huge false-filled circle, PENDING #10) once already. This paints the circle
			// directly instead, so there is no hole/fill-rule trick to get backwards: it is big
			// enough to cover the whole screen from any point on the perimeter while the mode
			// switch is actually closing (`toOpen` near 1), then shrinks down to a small ball
			// that just keeps circling once open (`toOpen` near 0), instead of growing into
			// something that blocks the view.
			const perim = 2 * (Width + Height);
			function pointOnPerim(p) {
				p = ((p % perim) + perim) % perim;
				if (p < Width) { return { x: p, y: 0 }; }
				p -= Width;
				if (p < Height) { return { x: Width, y: p }; }
				p -= Height;
				if (p < Width) { return { x: Width - p, y: Height }; }
				p -= Width;
				return { x: 0, y: Height - p };
			}
			const chaser = pointOnPerim(T * 4);
			const restR = 46 + Math.sin(T / 30) * 6;
			const bigR = Math.hypot(Width, Height);
			const r = restR + toOpen * (bigR - restR);
			ctx.beginPath();
			ctx.arc(chaser.x, chaser.y, r, 0, Math.PI * 2);
			ctx.fillStyle = 'white';
			ctx.fill();
			ctx.globalCompositeOperation = 'hard-light';
			{
				// Cycles through Tag's four team colours (SocketSchema's own order, same as
				// #gamemode-box .taggm's gradient) as it goes, instead of picking one.
				const colors = ['#36e27f', '#ff5242', '#ffd400', '#579aff'];
				const cIdx = Math.floor(T / 120) % colors.length;
				const grd = ctx.createRadialGradient(chaser.x, chaser.y, 0, chaser.x, chaser.y, r);
				grd.addColorStop(0, colors[cIdx]);
				grd.addColorStop(1, 'rgba(0,0,0,0)');
				ctx.fillStyle = grd;
				ctx.globalAlpha = 0.35;
				ctx.beginPath();
				ctx.arc(chaser.x, chaser.y, r, 0, Math.PI * 2);
				ctx.fill();
			}
			break;
		}
		case 'boss': {
			// No literal boss silhouette drawn here on purpose - more bosses than the Summoner are
			// coming (diep_wiki has several), so nothing in the menu should read as "this specific
			// one". Instead, a slow ominous iris: a circular hole in a white sheet that grows from
			// nothing (closed) to the whole screen (open), rather than wiping in from a corner like
			// every team mode. A faint ring is left trailing just inside the hole's edge - an "eye"
			// without a face - and the whole thing breathes gently rather than holding still.
			const maxR = Math.hypot(Width, Height) / 2;
			const pulse = 1 + Math.sin(T / 70) * 0.04;
			const r = Math.max(0, (1 - toOpen) * maxR * pulse);
			ctx.beginPath();
			ctx.rect(0, 0, Width, Height);
			ctx.arc(Width / 2, Height / 2, r, 0, Math.PI * 2, true);
			ctx.fillStyle = 'white';
			ctx.fill('evenodd');
			ctx.beginPath();
			ctx.arc(Width / 2, Height / 2, r * 0.7, 0, Math.PI * 2);
			ctx.strokeStyle = 'rgba(255,255,255,0.5)';
			ctx.lineWidth = 8 + Math.sin(T / 50) * 3;
			ctx.stroke();
			ctx.globalCompositeOperation = 'hard-light';
			{
				let grd = ctx.createRadialGradient(Width / 2, Height / 2, 0, Width / 2, Height / 2, maxR);
				grd.addColorStop(0.10, '#c65ed6');
				grd.addColorStop(.400, '#9d3fbf');
				grd.addColorStop(.700, '#4b1f7a');
				grd.addColorStop(1.00, '#2b1055');
				ctx.fillStyle = grd;
				ctx.globalAlpha = Math.max(0, (1 - toOpen) / 5);
				ctx.fillRect(0, 0, Width, Height);
			}
			break;
		}
		case 'sandbox': {
			// A box, not a corner wipe: 4 edge panels recede from the centre outward. Top/bottom
			// slide fully offscreen once open; left/right stop flush with the edge instead of
			// vanishing, so a thin frame stays on screen even at rest - Sandbox's own colour
			// (#gamemode-box .sandboxgm's green) reads as a box lid, not ffa's diagonal sheet.
			const margin = 22; // left/right panels' resting width once open - never fully vanish
			const jitterX = Math.sin(T / 90) * 8, jitterY = Math.sin(T / 95 + 1) * 8;
			ctx.fillStyle = 'white';
			const topEdge = -Height * 0.6 + toOpen * (Height / 2 + Height * 0.6) + jitterY;
			ctx.fillRect(0, -Height, Width, Height + topEdge);
			const botEdge = Height * 1.6 - toOpen * (Height * 1.6 - Height / 2) - jitterY;
			ctx.fillRect(0, botEdge, Width, Height * 2 - botEdge);
			const leftEdge = margin + toOpen * (Width / 2 - margin) + jitterX;
			ctx.fillRect(0, 0, leftEdge, Height);
			const rightEdge = Width - margin - toOpen * (Width / 2 - margin) - jitterX;
			ctx.fillRect(rightEdge, 0, Width - rightEdge, Height);
			ctx.globalCompositeOperation = 'hard-light';
			{
				let grd = ctx.createLinearGradient(0, 0, 0, Height);
				grd.addColorStop(0.00, '#0f5132');
				grd.addColorStop(.400, '#157347');
				grd.addColorStop(.700, '#1a9c5b');
				grd.addColorStop(1.00, '#56cf94');
				ctx.fillStyle = grd;
				ctx.globalAlpha = Math.max(0, (1 - toOpen) / 5.5);
				ctx.fillRect(0, 0, Width, Height);
			}
			break;
		}
		case 'maze': {
			// Vertical slats alternating from the top/bottom edges, not a diagonal wipe - Maze's
			// own wall studs snapping into a corridor, in the wall dot's own greys
			// (public/client/config.js's Palette.wall / #gamemode-box .mazegm) rather than a team
			// colour, since there is no team here. Reach exceeds Height at toOpen 1 regardless of
			// jitter, so every column still fully whites out the screen when closed.
			const cols = 7;
			const colW = Width / cols;
			ctx.fillStyle = 'white';
			for (let i = 0; i < cols; i++) {
				const extent = Math.max(0, toOpen * (Height + 40) + Math.sin(T / 70 + i) * 10);
				if (i % 2 === 0) {
					ctx.fillRect(i * colW, 0, colW + 1, extent);
				} else {
					ctx.fillRect(i * colW, Height, colW + 1, -extent);
				}
			}
			ctx.globalCompositeOperation = 'hard-light';
			{
				let grd = ctx.createLinearGradient(0, 0, Width, 0);
				grd.addColorStop(0.00, '#3d3d3d');
				grd.addColorStop(.400, '#5c5c5c');
				grd.addColorStop(.700, '#7d7d7d');
				grd.addColorStop(1.00, '#bdbdbd');
				ctx.fillStyle = grd;
				ctx.globalAlpha = Math.max(0, (1 - toOpen) / 6);
				ctx.fillRect(0, 0, Width, Height);
			}
			break;
		}
		case 'domination': {
			// Same diagonal two-corner wipe silhouette as 2 Teams (Domination is a 2-team mode
			// too, SocketSchema's own team order), not the fixed-width centre gap the first
			// draft used - PENDING #10 caught that the fixed ~180px gap left the reveal a tiny
			// sliver of the screen no matter how wide it was, since the gap never scaled with
			// Width/Height the way every other mode's wipe does. Colours are green/red like 2
			// Teams; a thin diamond outline (not a filled panel, so it never blocks the reveal)
			// stays stencilled at the centre - the loose diamond the four Dominators sit in
			// (PENDING #27) - fading in only as the screen closes.
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(225 + toOpen * (Width / 2 - 225) + Math.sin(T / 78) * 15, 0);
			ctx.lineTo(0 + toOpen * (Width / 2) + Math.sin(T / 78) * 15, Height * 1.25 + 375);
			ctx.lineTo(0, Height)
			///
			ctx.moveTo(Width, Height);
			ctx.lineTo(Width - 225 - toOpen * (Width / 2 - 225) + (1 - toOpen) * (Math.sin(1 + T / 75) * 15), Height);
			ctx.lineTo(Width - toOpen * (Width / 2) + (1 - toOpen) * (Math.sin(1 + T / 75) * 15), (Height - Height * 1.25) - 375);
			ctx.lineTo(Width, 0);
			///
			ctx.closePath();
			ctx.fillStyle = 'white';
			ctx.fill();
			//////////////////////////////////////////
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(180 + toOpen * (Width / 2 - 180) + (Math.sin(.5 + T / 83) * 10) * (1 - toOpen), 0);
			ctx.lineTo(0 + toOpen * (Width / 2) + (Math.sin(.5 + T / 83) * 10) * (1 - toOpen), Height + 300);
			ctx.lineTo(0, Height)
			///
			ctx.moveTo(Width, Height);
			ctx.lineTo(Width - 180 - toOpen * (Width / 2 - 180) + (1 - toOpen) * (Math.sin(1.5 + T / 80) * 10), Height);
			ctx.lineTo(Width - toOpen * (Width / 2) + (1 - toOpen) * (Math.sin(1.5 + T / 80) * 10), -300);
			ctx.lineTo(Width, 0);
			///
			ctx.closePath();
			ctx.fillStyle = 'white';
			ctx.fill();
			ctx.save();
			ctx.translate(Width / 2, Height / 2);
			ctx.rotate(Math.PI / 4 + Math.sin(T / 200) * 0.08);
			const d = Math.min(Width, Height) * 0.2;
			ctx.strokeStyle = 'rgba(255,255,255,' + Math.max(0, (1 - toOpen) * 0.6) + ')';
			ctx.lineWidth = 6;
			ctx.strokeRect(-d / 2, -d / 2, d, d);
			ctx.restore();
			///GRADIENT///
			{
				ctx.globalCompositeOperation = 'hard-light';
				let grd = ctx.createLinearGradient(0, 0, Width, 0);
				grd.addColorStop(0.00, '#36e27f');
				grd.addColorStop(.500, '#ffd400');
				grd.addColorStop(1.00, '#ff5242');
				ctx.fillStyle = grd;
				ctx.globalAlpha = Math.max(0, (1 - toOpen) / 5.5);
				ctx.fillRect(0, 0, Width, Height);
			}
			break;
		}
		case '2team':
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(225 + toOpen * (Width / 2 - 225) + Math.sin(T / 78) * 15, 0);
			ctx.lineTo(0 + toOpen * (Width / 2) + Math.sin(T / 78) * 15, Height * 1.25 + 375);
			ctx.lineTo(0, Height)
			///
			ctx.moveTo(Width, Height);
			ctx.lineTo(Width - 225 - toOpen * (Width / 2 - 225) + (1 - toOpen) * (Math.sin(1 + T / 75) * 15), Height);
			ctx.lineTo(Width - toOpen * (Width / 2) + (1 - toOpen) * (Math.sin(1 + T / 75) * 15), (Height - Height * 1.25) - 375);
			ctx.lineTo(Width, 0);
			///
			ctx.closePath();
			ctx.fillStyle = 'white';
			ctx.fill();
			//////////////////////////////////////////
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(180 + toOpen * (Width / 2 - 180) + (Math.sin(.5 + T / 83) * 10) * (1 - toOpen), 0);
			ctx.lineTo(0 + toOpen * (Width / 2) + (Math.sin(.5 + T / 83) * 10) * (1 - toOpen), Height + 300);
			ctx.lineTo(0, Height)
			///
			ctx.moveTo(Width, Height);
			ctx.lineTo(Width - 180 - toOpen * (Width / 2 - 180) + (1 - toOpen) * (Math.sin(1.5 + T / 80) * 10), Height);
			ctx.lineTo(Width - toOpen * (Width / 2) + (1 - toOpen) * (Math.sin(1.5 + T / 80) * 10), -300);
			ctx.lineTo(Width, 0);
			///
			ctx.closePath();
			ctx.fillStyle = 'white';
			ctx.fill();
			///GRADIENT///
			{
				ctx.globalCompositeOperation = 'hard-light';
				let grd = ctx.createLinearGradient(0, -Height / 2, Width, 0);
				grd.addColorStop(0.10, '#f45520');
				grd.addColorStop(.400, '#d97f24');
				grd.addColorStop(.700, '#bca61a');
				//grd.addColorStop(.800, '#8ec749');
				grd.addColorStop(1.00, '#36e27f');

				ctx.fillStyle = grd;
				ctx.globalAlpha = Math.max(0, (1 - toOpen) / 4.8);
				ctx.fillRect(0, 0, Width, Height);
			}
			break;
		case '4team':
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(300 + toOpen * (Width - 300) + Math.sin(T / 80) * 15, 0);
			ctx.lineTo(0, 600 + toOpen * (Height - 600) + Math.sin(T / 80) * 30);
			///
			ctx.moveTo(Width, Height);
			ctx.lineTo((1 - toOpen) * (Width - 300) - Math.sin(1 + T / 80) * 15, Height);
			ctx.lineTo(Width, (1 - toOpen) * (Height - 600) - Math.sin(1 + T / 80) * 30);
			///
			//ctx.closePath();
			ctx.fillStyle = 'white';
			ctx.fill();
			//////////////////////////////////////////
			ctx.beginPath();
			ctx.moveTo(Width, 0);
			ctx.lineTo((1 - toOpen) * ((Width - 300) - (Math.sin(.5 + T / 80) * 15)), 0);
			ctx.lineTo(Width, 600 + toOpen * (Height - 600) + (Math.sin(.5 + T / 80) * 30) * (1 - toOpen));
			///
			ctx.moveTo(0, Height);
			ctx.lineTo(300 + toOpen * (Width - 300) + Math.sin(1.5 + T / 80) * 15 * (1 - toOpen), Height);
			ctx.lineTo(0, (1 - toOpen) * ((Height - 600) - (Math.sin(1.5 + T / 80) * 30)));
			///
			ctx.fillStyle = 'white';
			ctx.fill();
			{
				ctx.globalCompositeOperation = 'hard-light';
				let grd = ctx.createLinearGradient(0, Height, 0, -Height);
				grd.addColorStop(0.00, '#833ab4');
				//grd.addColorStop(.200, '#7303c0');
				grd.addColorStop(.500, '#fd1d1d');
				grd.addColorStop(1, '#fcb045');

				ctx.fillStyle = grd;
				ctx.globalAlpha = Math.max(0, (1 - toOpen) / 6.8);
				ctx.fillRect(0, 0, Width, Height);
			}
			break;
		case 'ffa':
		default:
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(500 + toOpen * (Width - 500) + Math.sin(T / 80) * 30, 0);
			ctx.lineTo(0, 400 + toOpen * (Height - 400) + Math.sin(T / 80) * 17);
			///
			ctx.moveTo(Width, Height);
			ctx.lineTo((1 - toOpen) * (Width - 500) - Math.sin(1 + T / 80) * 30, Height);
			ctx.lineTo(Width, (1 - toOpen) * (Height - 400) - Math.sin(1 + T / 80) * 18);
			///
			ctx.closePath();
			ctx.fillStyle = 'white';
			ctx.fill();
			//////////////////////////////////////////
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(400 + toOpen * (Width - 400) + (Math.sin(.5 + T / 80) * 20) * (1 - toOpen) + 5, 0);
			ctx.lineTo(0, 300 + toOpen * (Height - 300) + (Math.sin(.5 + T / 80) * 15) * (1 - toOpen) + 5);
			///
			ctx.moveTo(Width, Height);
			ctx.lineTo((1 - toOpen) * ((Width - 400) - (Math.sin(1.5 + T / 80) * 20)) - 5, Height);
			ctx.lineTo(Width, (1 - toOpen) * ((Height - 300) - (Math.sin(1.5 + T / 80) * 15)) - 5);
			///
			ctx.closePath();
			ctx.fillStyle = 'white';
			ctx.fill();
			{
				//background-image: linear-gradient(to right top, #16bffd, #65a2f9, #a07fdd, #c456a8, #cb3066);
				ctx.globalCompositeOperation = 'hard-light';
				let grd = ctx.createLinearGradient(0, 0, 0, Height);
				grd.addColorStop(0.00, '#16BFFD');
				grd.addColorStop(.300, '#65a2f9');
				grd.addColorStop(.500, '#a07fdd');
				grd.addColorStop(.700, '#c456a8');
				grd.addColorStop(1.00, '#CB3066');

				ctx.fillStyle = grd;
				ctx.globalAlpha = Math.max(0, (1 - toOpen) / 5.5);
				ctx.fillRect(0, 0, Width, Height);
			}
			break;
	}
}

// Draws through the real client render pipeline (plan.md A5) - TanksConfig.class for geometry,
// CLIENT.General.drawTank (public/client/render.js) for the shapes - instead of a private,
// hand-authored CLASS table that had drifted from every in-game silhouette. isOpac=1 makes
// drawTank draw straight into the passed ctx (no off-screen sprite cache, unneeded for a fully
// opaque background tank - see render.js's own isOpac branch).
function tank(x, y, angle, size, type, color) {
	if (!TanksConfig.class[type]) { return; }
	ctx.save();
	ctx.translate(x, y);
	CLIENT.General.drawTank(ctx, 1, {
		class: type,
		tankC: color,
		canC: [C.gray, C.dkgray],
		size: size,
		dir: angle / 360 * Math.PI * 2,
		recoils: [],
		canDir: []
	});
	ctx.restore();
}
function obj(x, y, angle, type) {
	ctx.save()
	ctx.translate(x, y);
	ctx.rotate(angle / 360 * Math.PI * 2);
	ctx.beginPath()
	switch (type) {
		case 'square': ctx.rect(-16, -16, 32, 32);
			ctx.fillStyle = C.square; ctx.strokeStyle = C.dksquare;
			break;
		case 'triangle':
			ctx.moveTo(25, 0); ctx.lineTo(Math.cos(Math.PI * 2 / 3) * 25, Math.sin(Math.PI * 2 / 3) * 25); ctx.lineTo(Math.cos(Math.PI * 4 / 3) * 25, Math.sin(Math.PI * 4 / 3) * 25); ctx.closePath();
			ctx.fillStyle = C.trian; ctx.strokeStyle = C.dktrian;
			break;
		case 'pentagon': ctx.moveTo(42, 0);
			ctx.lineTo(Math.cos(Math.PI * 2 / 5) * 42, Math.sin(Math.PI * 2 / 5) * 42);
			ctx.lineTo(Math.cos(Math.PI * 4 / 5) * 42, Math.sin(Math.PI * 4 / 5) * 42);
			ctx.lineTo(Math.cos(Math.PI * 6 / 5) * 42, Math.sin(Math.PI * 6 / 5) * 42);
			ctx.lineTo(Math.cos(Math.PI * 8 / 5) * 42, Math.sin(Math.PI * 8 / 5) * 42);
			ctx.closePath();
			ctx.fillStyle = C.penta; ctx.strokeStyle = C.dkpenta;
			break;
	}
	ctx.lineWidth = LW;
	ctx.lineJoin = "bevel";
	ctx.fill();
	ctx.stroke();
	ctx.restore()
}
function bull(x, y, size, color) {
	ctx.beginPath()
	ctx.arc(x, y, size / 3, 0, Math.PI * 2);
	ctx.closePath();
	ctx.fillStyle = color[0];
	ctx.strokeStyle = color[1];
	ctx.lineWidth = LW;
	ctx.fill();
	ctx.stroke();
}
function drone(x, y, angle, size, color) {
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(angle / 360 * Math.PI * 2);
	ctx.beginPath();
	ctx.moveTo(size, 0); ctx.lineTo(Math.cos(Math.PI * 2 / 3) * size, Math.sin(Math.PI * 2 / 3) * size); ctx.lineTo(Math.cos(Math.PI * 4 / 3) * size, Math.sin(Math.PI * 4 / 3) * size);
	ctx.closePath();
	ctx.fillStyle = color[0];
	ctx.strokeStyle = color[1];
	ctx.lineWidth = LW;
	ctx.lineJoin = 'bevel';
	ctx.fill();
	ctx.stroke();
	ctx.restore();
}
