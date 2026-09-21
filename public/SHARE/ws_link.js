/*
	Where the client opens its game socket.

	Default: the same origin that served this page. Split deployment: start the web
	half with WS_LINK=wss://game.example.com and the server hands that down through
	POST.ws. play.ejs defines POST before loading this file.
*/
window.WS_LINK = (function () {
	if (typeof POST !== 'undefined' && POST && POST.ws) {
		return POST.ws;
	}
	return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
})();
