/*
	Account chip + auth modal + achievements panel (HANDOFF Part 1.5 / 2.3).

	Runs on the menu page only, right after shop.js (so window.Mess already exists). Rather
	than firing a second /userData request, it hangs a hook - window.onUserData - that
	queue.js's existing XHR callback invokes once it has a response; see the one-line change
	there. That is also why the two render calls at the bottom exist: this script runs
	synchronously before that XHR resolves, so they paint a logged-out/zero-achievements
	default first, then get overwritten a moment later with the real state.
*/
(function (window) {
	const chip = document.getElementById('account-chip');
	const achEdge = document.getElementById('ach-edge');
	const achList = document.getElementById('ach-edge-list');

	const box = document.createElement('DIV');
	box.id = 'accountBox';
	box.classList.add('white-box', 'hideDiv');
	box.innerHTML =
		"<input type='radio' id='login_is' class='radio' name='acc_radios' checked>" +
		"<label for='login_is'>Log In</label>" +
		"<input type='radio' id='signup_is' class='radio' name='acc_radios'>" +
		"<label for='signup_is'>Sign Up</label>" +
		"<div id='login_form' class='acc-form'>" +
		"<input id='login_username' placeholder='Username' maxlength='16'>" +
		"<input id='login_password' type='password' placeholder='Password' maxlength='72'>" +
		"<button class='acc-submit' id='login_submit'>Log In</button>" +
		"</div>" +
		"<div id='signup_form' class='acc-form'>" +
		"<input id='signup_username' placeholder='Username' maxlength='16'>" +
		"<input id='signup_password' type='password' placeholder='Password' maxlength='72'>" +
		"<input id='signup_email' placeholder='Email (optional)' maxlength='254'>" +
		"<button class='acc-submit' id='signup_submit'>Sign Up</button>" +
		"</div>";
	document.body.appendChild(box);

	const prevent = document.getElementById('prevent_click');
	function openBox(tab) {
		document.getElementById(tab + '_is').checked = true;
		box.classList.remove('hideDiv');
		box.classList.add('showDiv');
		prevent.classList.remove('hide-prevent');
		prevent.onclick = closeBox;
	}
	function closeBox() {
		box.classList.remove('showDiv');
		box.classList.add('hideDiv');
		prevent.classList.add('hide-prevent');
	}

	function post(url, body) {
		return new Promise((resolve) => {
			const Req = new XMLHttpRequest();
			Req.onload = function () {
				let data;
				try { data = JSON.parse(this.responseText); } catch { data = { error: "The action couldn't be done." }; }
				resolve(data);
			};
			Req.onerror = Req.onabort = function () { resolve({ error: "The action couldn't be done." }); };
			Req.open('post', url, true);
			Req.setRequestHeader('Content-type', 'application/json');
			Req.send(JSON.stringify(body));
		});
	}

	function getGuestAch() {
		try { return JSON.parse(localStorage.getItem('obstar_ach')) || {}; } catch { return {}; }
	}

	document.getElementById('login_submit').onclick = function () {
		const username = document.getElementById('login_username').value;
		const password = document.getElementById('login_password').value;
		Mess.send('none', 'Logging in...', 1);
		post('/auth/login', { username: username, password: password }).then((data) => {
			if (data.error) { Mess.send('abort', data.error); return; }
			Mess.send('valid', 'Logged in.');
			window.location.reload();
		});
	};

	document.getElementById('signup_submit').onclick = function () {
		const username = document.getElementById('signup_username').value;
		const password = document.getElementById('signup_password').value;
		const email = document.getElementById('signup_email').value;
		Mess.send('none', 'Creating your account...', 1);
		// Fold the guest's local achievement unlocks into the account being created - see the
		// matching req.body.ach handling in web/app.js's /auth/signup.
		post('/auth/signup', { username: username, password: password, email: email, ach: getGuestAch() }).then((data) => {
			if (data.error) { Mess.send('abort', data.error); return; }
			Mess.send('valid', 'Account created.');
			window.location.reload();
		});
	};

	function renderChip(data) {
		chip.innerHTML = '';
		const top = document.createElement('DIV');
		top.className = 'chip-top';
		const name = document.createElement('SPAN');
		name.className = 'name';
		// Mirrors #coin-data (public/queue.js) rather than moving it - the chip is just a
		// second, natural-feeling place to see the same balance (THEPLAN Part 1.5).
		const coins = document.createElement('SPAN');
		coins.className = 'chip-coins';
		coins.textContent = (data && typeof data.coins === 'number') ? data.coins : 0;
		top.appendChild(name);
		top.appendChild(coins);
		const actions = document.createElement('DIV');
		actions.className = 'chip-actions';
		if (data && data.loggedIn) {
			name.textContent = data.username;
			const logout = document.createElement('BUTTON');
			logout.textContent = 'Log Out';
			logout.onclick = function () {
				post('/auth/logout', {}).then(() => window.location.reload());
			};
			actions.appendChild(logout);
		} else {
			name.textContent = 'Guest';
			const login = document.createElement('BUTTON');
			login.textContent = 'Log In';
			login.onclick = function () { openBox('login'); };
			const signup = document.createElement('BUTTON');
			signup.textContent = 'Sign Up';
			signup.onclick = function () { openBox('signup'); };
			actions.appendChild(login);
			actions.appendChild(signup);
		}
		chip.appendChild(top);
		chip.appendChild(actions);
	}

	/*
		Diep-style wheel: a fixed set of DOM nodes (the achievement list, repeated end-to-end
		enough times to cover the panel with no gap at the wrap point) placed every frame by
		`layout()` at `y = (i*PITCH - offset) mod TOTAL`, so the scroll never resets/jumps - it
		just keeps counting up. `tick()` is the one requestAnimationFrame loop that both slides
		`offset` (auto-scroll, paused 1.5s after a manual wheel nudge) and eases `reveal` in/out
		on hover, then calls `layout()` to place and shape every item from those two numbers.
	*/
	const GAP = 16;
	const SPEED = 18; // px/s auto-scroll
	const WHEEL_SCALE = 0.6;
	const REVEAL_MS = 350;
	// Item sizing/positioning constants - kept in sync by hand with the #ach-edge /
	// .ach-item rules in public/style.css (search that file for the same names).
	const ITEM_H = 56;      // absolute rendered height of every item, any aspect ratio
	const ITEM_MAX_W = 280; // 56 * (320/64) - widest legacy asset at ITEM_H
	const RIGHT_GAP = 25;   // right margin of the centred (widest-point) item
	const HOVER_W = 220;    // reveal trigger zone, decoupled from panel width
	const SCALE_MIN = 0.85; // wheel recession scale at the top/bottom edges
	let items = []; // one '.ach-item' div per repeated slot, length N*k
	let itemHeight = 0, PITCH = 0, TOTAL = 0;
	let offset = 0;
	let lastManual = 0;
	let hovering = false;
	let reveal = 0;
	let lastMerged = {};

	// Icons only, on purpose - this is a peek panel you glance at, not a page you read.
	function renderAchievements(data) {
		const server = (data && data.ach) || {};
		lastMerged = Object.assign({}, getGuestAch(), server);
		buildItems();
	}

	// The one seam between "how an achievement is stored" and "what the wheel puts on
	// screen" (plan.md Part 4): AchievementsConfig entries with a `badge` field render as a
	// drawn AchievementBadge canvas, everything else keeps today's <img>. No entry sets
	// `badge` yet, so this always takes the img branch for now.
	function makeAchNode(entry, opts) {
		const locked = !!(opts && opts.locked);
		const secret = !!(opts && opts.secret);
		const title = secret ? '???' : (entry.name + ' - ' + entry.desc);
		if (entry.badge) {
			const view = secret ? Object.assign({}, entry, { name: '???', desc: '???' }) : entry;
			const canvas = AchievementBadge.draw(view, { scale: window.devicePixelRatio || 1, locked: locked });
			canvas.style.height = ITEM_H + 'px';
			canvas.style.width = 'auto';
			canvas.title = title;
			return canvas;
		}
		const img = document.createElement('IMG');
		img.className = locked ? 'locked' : '';
		img.src = './pic/img_mess/' + (secret ? 'achievement.png' : entry.icon);
		// Not shown as text in the panel (that is the whole point of it being icon-only),
		// but a native title tooltip costs nothing and means locked-and-hidden isn't a
		// total mystery to someone who deliberately hovers one icon rather than the edge.
		img.title = title;
		return img;
	}

	function buildItems() {
		const list = AchievementsConfig.list;
		const n = list.length;
		if (!n) { achList.innerHTML = ''; items = []; return; }
		const panelH = achList.clientHeight || achEdge.clientHeight;
		// Height is absolute (ITEM_H), not derived from panel width - see the design-constants
		// block above. That's what keeps every item exactly 56px tall regardless of asset aspect
		// ratio (the 86x86 Kawaii Smash icon included) and independent of viewport width. Resize
		// still calls buildItems (below) purely to recount k for the new panelH.
		itemHeight = ITEM_H;
		PITCH = itemHeight + GAP;
		const k = Math.max(1, Math.ceil((panelH + PITCH) / (n * PITCH)));
		const total = n * k;
		TOTAL = total * PITCH;
		achList.innerHTML = '';
		items = [];
		for (let i = 0; i < total; i++) {
			const entry = list[i % n];
			const has = !!lastMerged[entry.id];
			const secret = entry.hidden && !has;
			const item = document.createElement('DIV');
			item.className = 'ach-item';
			item.appendChild(makeAchNode(entry, { locked: !has, secret: secret }));
			achList.appendChild(item);
			items.push(item);
		}
		layout();
	}

	function layout() {
		if (!items.length || !PITCH) { return; }
		const panelH = achList.clientHeight;
		const centreY = panelH / 2;
		const slideIn = (1 - reveal) * 140;
		for (let i = 0; i < items.length; i++) {
			const y = ((i * PITCH - offset) % TOTAL + TOTAL) % TOTAL;
			const itemCentreY = y + itemHeight / 2;
			let d = panelH ? (itemCentreY - centreY) / (panelH / 2) : 0;
			d = Math.max(-1, Math.min(1, d));
			const ad = Math.abs(d);
			const opacity = Math.max(0, 1 - 0.8 * Math.pow(ad, 1.3));
			const scale = 1 - (1 - SCALE_MIN) * ad;
			// Inward recession: RIGHT_GAP clear of the edge at centre, sliding right to flush
			// (never past it) at the top/bottom - the inverse of the old outward push, which
			// clipped the centred item against #ach-edge's own right:0 / overflow:hidden.
			const inset = RIGHT_GAP * (1 - Math.pow(ad, 1.5));
			const translateX = slideIn - inset;
			const el = items[i];
			el.style.top = y + 'px';
			el.style.opacity = opacity;
			el.style.transform = 'translateX(' + translateX + 'px) scale(' + scale + ')';
		}
	}

	let lastFrame = 0;
	function tick(now) {
		const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
		lastFrame = now;
		const target = hovering ? 1 : 0;
		const step = (dt * 1000) / REVEAL_MS;
		reveal = reveal < target ? Math.min(target, reveal + step) : Math.max(target, reveal - step);
		achEdge.style.opacity = reveal;
		if (Date.now() - lastManual >= 1500) { offset += SPEED * dt; }
		layout();
		requestAnimationFrame(tick);
	}
	requestAnimationFrame(tick);

	// pointer-events:none keeps #ach-edge out of the way of the buttons underneath it (Info,
	// Follow, the account chip), so the hover/reveal check runs off the raw cursor position
	// instead of a `:hover`/`mouseenter` on an element that no longer receives pointer events.
	window.addEventListener('mousemove', function (e) {
		const panelWidth = Math.min(achEdge.offsetWidth, HOVER_W);
		hovering = e.clientX > window.innerWidth - panelWidth;
	});
	window.addEventListener('wheel', function (e) {
		if (!hovering) { return; }
		offset += e.deltaY * WHEEL_SCALE;
		lastManual = Date.now();
	});
	let resizeTimer = null;
	window.addEventListener('resize', function () {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(buildItems, 150);
	});

	window.onUserData = function (data) {
		renderChip(data);
		renderAchievements(data);
	};
	renderChip(window.UserData);
	renderAchievements(window.UserData);
})(window);
