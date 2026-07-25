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

	// Icons only, on purpose - this is a peek panel you glance at, not a page you read.
	function renderAchievements(data) {
		const server = (data && data.ach) || {};
		const merged = Object.assign({}, getGuestAch(), server);
		achList.innerHTML = '';
		for (const entry of AchievementsConfig.list) {
			const has = !!merged[entry.id];
			const secret = entry.hidden && !has;
			const img = document.createElement('IMG');
			img.className = has ? '' : 'locked';
			img.src = './pic/img_mess/' + (secret ? 'achievement.png' : entry.icon);
			// Not shown as text in the panel (that is the whole point of it being icon-only),
			// but a native title tooltip costs nothing and means locked-and-hidden isn't a total
			// mystery to someone who deliberately hovers one icon rather than the edge itself.
			img.title = secret ? '???' : (entry.name + ' - ' + entry.desc);
			achList.appendChild(img);
		}
	}

	/*
		Auto-scroll while the edge is hovered, slow enough to read the icons going by. Ping-pongs
		at the ends rather than jumping back to the top, so it never looks like a stutter.
		Any wheel/touch scroll is real user intent, so it takes over immediately and auto-scroll
		stays out of the way for a few seconds afterwards instead of instantly fighting it.
	*/
	let scrollTimer = null;
	let scrollDir = 1;
	let lastManual = 0;
	function stepScroll() {
		if (Date.now() - lastManual < 1500) { return; }
		const max = achList.scrollHeight - achList.clientHeight;
		if (max <= 0) { return; }
		achList.scrollTop += scrollDir * 0.6;
		if (achList.scrollTop >= max) { scrollDir = -1; }
		else if (achList.scrollTop <= 0) { scrollDir = 1; }
	}
	achEdge.addEventListener('mouseenter', function () {
		if (!scrollTimer) { scrollTimer = setInterval(stepScroll, 30); }
	});
	achEdge.addEventListener('mouseleave', function () {
		if (scrollTimer) { clearInterval(scrollTimer); scrollTimer = null; }
	});
	achList.addEventListener('wheel', function () { lastManual = Date.now(); });
	achList.addEventListener('touchmove', function () { lastManual = Date.now(); });

	window.onUserData = function (data) {
		renderChip(data);
		renderAchievements(data);
	};
	renderChip(window.UserData);
	renderAchievements(window.UserData);
})(window);
