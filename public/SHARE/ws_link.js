/*
	Where the client opens its game socket.

	Default: the same origin that served this page. That is correct whenever the game and the
	site share a process (`node server.js`, which is the normal way to run this) and it gets
	wss:// right automatically behind TLS - the old hardcoded 'ws://localhost:8080' was both
	wrong on any deployed box and blocked as mixed content on an https page.

	Split deployment: start the web half with WS_LINK=wss://game.example.com and the server
	hands that down through POST.ws below. play.ejs therefore defines POST *before* loading
	this file; do not move the script tags back.
*/
window.WS_LINK = (function () {
	if (typeof POST !== 'undefined' && POST && POST.ws) {
		return POST.ws;
	}
	return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
})();
