const request = require('request');
const { getWebpage } = require('./browse');
const config = require('../config.json');

const DefaultOptions = {
	method: 'GET',
	timeout: 30000,
	headers: {
		'Accept': 'text/html,application/xhtml+xml,application/xml',
		'Accept-Language': 'en',
		'Cache-Control': 'max-age=0',
		'Connection': 'keep-alive',
		'DNT': 1
	}
};
if (!!config.extensions?.google_search?.proxy) {
	DefaultOptions.proxy = config.extensions.google_search.proxy;
}

const command = {
	"name": "Scholar",
	"cmd": "google_scholar_search",
	"alias": [
		'google_scholar',
		'scholar_search',
		'googlescholar',
		'scholarsearch',
	],
	"args": {
		"query": "query"
	}
};

const parseParams = param => {
	var json = {};
	param = (param || '').split('?');
	param.shift();
	param = (param || '').join('?').split('&');
	param.forEach(item => {
		item = item.split('=');
		var key = item.shift();
		item = item.join('=');
		json[key] = item;
	});
	return json;
};
const clearHTML = content => {
	return content
		.replace(/<a[^>]*?href="[^"]*?"[^>]*?>[\w\W]*?<\/a>/gi, '')
		.replace(/<\/?[^>]*?>/gi, '')
		.replace(/^[\s\r\n]+|[\s\r\n]+$/gi, '')
		.replace(/[\s\r\n]+/gi, ' ')
		.replace(/&#(\d+);/g, (match, code) => {
			var char;
			try {
				char = String.fromCharCode(code * 1);
			}
			catch {
				char = match;
			}
			return char;
		})
	;
};

const scrabGoogle = async (query) => {
	query = encodeURIComponent(query);

	var limit = config.extensions?.google_search?.count;
	if (!(limit > 0)) limit = 10;
	var url = `https://scholar.google.com/scholar?hl=en&q=${query}`;
	var requestOptions = Object.assign({}, DefaultOptions, { url });

	var content = await getWebpage(requestOptions);

	content = content
		.replace(/<![^>]*?>/gi, '')
		.replace(/\/\*+[\w\W]*?\*+\//gi, '')
		.replace(/<(noscript|script|head|link|rel|title|style|header|footer|form|button|ul|ol|li|option|select|table)[\w\W]*?>[\w\W]*?<\/\1>/gi, '')
		.replace(/<(meta|input|img|link|rel)[\w\W]*?>/gi, '')
		.replace(/<[^\/\\]*?[\/\\]>/gi, '')
		.replace(/<\/?(html|body)[^>]*?>/gi, '')
		.replace(/<\/?(span|lable)[^>]*?>/gi, '')
		.replace(/<\/?(div|p|br|hr)[^>]*?>/gi, '\n')
	;
	var pos = content.match(/<h3/i);
	if (!pos || !(pos.index >= 0)) {
		return 'nothing found.';
	}
	pos = pos.index;
	content = content.substring(pos);
	content = content.replace(/<a[^>]*?href="\/[^>]*?>/gi, '<a>');
	pos = [Infinity, Infinity];
	content.replace(/<a[^>]*?>\s*create\s*alert\s*<\/a>/gi, (match, p) => {
		pos[0] = p;
	});
	content.replace(/<center[^>]*?>[\w\W]*?<\/center>/gi, (match, p) => {
		pos[1] = p;
	});
	pos = Math.min(...pos);
	if (pos < content.length) content = content.substring(0, pos);

	pos = [];
	content.replace(/<h3/gi, (match, p) => {
		pos.push(p);
		return match;
	});
	pos.push(content.length);
	var result = [];
	for (let i = 0; i < pos.length - 1; i ++) {
		let start = pos[i], end = pos[i + 1];
		let part = content.substring(start, end);
		let url = '', title = '';
		part = part.replace(/<h3[^>]*?>([\w\W]*?)<\/h3>/, (match, inner) => {
			if (!inner) return '';
			var link = inner.match(/<a[^>]*?href="([^"]*?)"[^>]*?>([\w\W]*?)<\/a>/i);
			if (!link) return '';
			url = link[1];
			title = link[2];
			return '';
		});
		if (!url || !title) continue;
		title = clearHTML(title);
		part = clearHTML(part);
		result.push('- URL: ' + url + '\n  Title: ' + title + '\n  Description: ' + part);
	}
	return result.join('\n');
};
const searchGoogle = async (query) => {
	query = encodeURIComponent(query);

	var limit = config.extensions?.google_search?.count;
	if (!(limit > 0)) limit = 10;
	var url = `https://customsearch.googleapis.com/customsearch/v1?key=${config.extensions.google_search.apikey}&cx=${config.extensions.google_search.cx}&q=${query}&sort=date-sdate:d:s`;
	var requestOptions = Object.assign({}, DefaultOptions, { url });

	var content = await getWebpage(requestOptions);
	content = JSON.parse(content);
	if (!content.items || !content.items.length) {
		return 'nothing found.';
	}

	content = content.items.map(item => {
		var list = ['- URL: ' + item.link];
		list.push('  Title: ' + item.title);
		list.push('  Description: ' + item.snippet.replace(/[\r\n]/g, ''));
		return list.join('\n')
	}).join('\n');
	return content;
};

command.execute = async (type, caller, target) => {
	var retryMax = config.setting?.retry || 1;
	if (!(retryMax > 1)) retryMax = 1;

	var query, prepare;
	for (let key in target) {
		let value = target[key];
		if ((value * 1) + '' !== value && !['true', 'false'].includes(value.toLowerCase())) {
			prepare = value;
		}
		if (!!key.match(/\b(args?|name|q|query|s|search|f|find|keywords?)\b/i)) {
			query = value;
			break;
		}
	}
	if (!query) query = prepare;
	if (!query) {
		return {
			speak: "Empty Google Scholar Search.",
			reply: 'empty scholar search',
			exit: false
		};
	}

	var useAPI = !!config.extensions.google_search.apikey && !!config.extensions.google_search.cx;
	useAPI = false;
	var result;
	for (let i = retryMax; i > 0; i --) {
		try {
			if (useAPI) {
				result = await searchGoogle(query);
			}
			else {
				result = await scrabGoogle(query);
			}
			result = result + '\n\nNow use these scholar search results to continue the mission.';
			return {
				speak: "Google Scholar Search for \"" + query + "\" finished.",
				reply: result,
				exit: false
			};
		}
		catch (err) {
			let msg = err.message || err.msg || err;
			console.error("Google Scholar Search \"" + query + "\" failed:" + msg)
			if (i > 1) {
				await wait(1000);
				console.error('Retry searching...');
				continue;
			}
			return {
				speak: "Google Scholar Search \"" + query + "\" failed:" + msg,
				reply: "failed",
				exit: false
			};
		}
	}
};

module.exports = command;