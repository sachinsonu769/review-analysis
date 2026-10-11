import transport from 'axios';
fetch('/audit/real'); // positive-global
fetch(`/audit/real`); // positive-template
globalThis.fetch('/audit/real'); // positive-member
transport.get('/audit/real'); // positive-axios
function scope(window: any, self: any, globalThis: any) {
 window.fetch('/audit/fake'); // negative-window
 self.fetch('/audit/fake'); // negative-self
 globalThis.fetch('/audit/fake'); // negative-globalthis
}
function parameters({fetch, transport}: any) {
 fetch('/audit/fake'); // negative-fetch
 transport.get('/audit/fake'); // negative-axios
}
const prefix = '/audit';
fetch(prefix + '/real'); // dynamic-concat
const options = {method: 'GET'};
fetch('/audit/real', options); // dynamic-options
fetch('/audit/real', {method: 'GET', method: 'POST'}); // positive-last-property
fetch('/audit/real', {method: 'GET', ...options}); // dynamic-spread
const fake = "fetch('/audit/fake')"; // negative-string
// fetch('/audit/fake'); negative-comment
