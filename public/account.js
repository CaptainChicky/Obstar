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
	const achCount = document.getElementById('ach-count');
	const achList = document.getElementById('ach-list');

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

	function renderAchievements(data) {
		const server = (data && data.ach) || {};
		const merged = Object.assign({}, getGuestAch(), server);
		const list = AchievementsConfig.list;
		let unlocked = 0;
		achList.innerHTML = '';
		for (const entry of list) {
			const has = !!merged[entry.id];
			if (has) { unlocked++; }
			const secret = entry.hidden && !has;
			const row = document.createElement('DIV');
			row.className = 'ach-entry' + (has ? '' : ' locked');
			const img = document.createElement('IMG');
			img.src = './pic/img_mess/' + (secret ? 'achievement.png' : entry.icon);
			const txt = document.createElement('DIV');
			txt.className = 'txt';
			const eName = document.createElement('SPAN');
			eName.className = 'name';
			eName.textContent = secret ? '???' : entry.name;
			const desc = document.createElement('SPAN');
			desc.className = 'desc';
			desc.textContent = secret ? '???' : entry.desc;
			txt.appendChild(eName);
			txt.appendChild(desc);
			row.appendChild(img);
			row.appendChild(txt);
			achList.appendChild(row);
		}
		achCount.textContent = unlocked + '/' + list.length;
	}

	window.onUserData = function (data) {
		renderChip(data);
		renderAchievements(data);
	};
	renderChip(window.UserData);
	renderAchievements(window.UserData);
})(window);
