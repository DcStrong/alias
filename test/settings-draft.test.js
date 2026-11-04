import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../game.js';
import { createSettingsDraft } from '../public/turns.js';

test('черновик хранит только отличия от последних серверных настроек и очищается после сохранения', () => {
  const draft = createSettingsDraft();
  const baseline = {mode:'pair', cycles:1, seconds:60};
  draft.capture({mode:'rotating', cycles:'3', seconds:'60'}, baseline);
  assert.deepEqual(draft.values(), {mode:'rotating', cycles:'3'});
  draft.capture({mode:'rotating', cycles:'1', seconds:'90'}, {...baseline, seconds:90});
  assert.deepEqual(draft.values(), {mode:'rotating'});
  draft.clear();
  assert.deepEqual(draft.values(), {});
});

// A minimal form surface recreates elements (including the selected option) on innerHTML writes.
function formSurface() {
  let elements = new Map();
  const document = {
    activeElement:null,
    getElementById:id => elements.get(id),
    querySelector:selector => selector === '#app' ? app : selector === '#connection' ? connection : elements.get(selector.slice(1))
  };
  const connection = {};
  const app = {
    addEventListener(){},
    querySelectorAll(selector) {
      return selector === 'input,select' ? [...elements.values()].filter(el => ['INPUT','SELECT'].includes(el.tagName)) : [];
    },
    set innerHTML(markup) {
      elements = new Map();
      document.activeElement = null;
      for (const match of markup.matchAll(/<(\w+)\b[^>]*\sid="([^"]+)"[^>]*>/g)) {
        const [,tag,id] = match;
        const el = {id, tagName:tag.toUpperCase(), value:'', focus(){document.activeElement=this;}};
        if (tag === 'select') {
          const options = markup.slice(match.index + match[0].length).split('</select>',1)[0];
          const entries = [...options.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)];
          const [, attrs, label] = entries.find(option => option[1].includes('selected')) || entries[0];
          el.value = /value="([^"]+)"/.exec(attrs)?.[1] ?? label;
        }
        elements.set(id,el);
      }
    }
  };
  return document;
}

test('форма лобби сохраняет черновик через SSE и принимает сохранённые в другой вкладке значения', async t => {
  const game = new Game(), room = game.create(), host = game.join(room);
  const document = formSurface();
  const field = id => document.getElementById(id);
  const view = () => game.view(room,host);
  const settings = values => game.action(room,host,{type:'settings',...view().settings,...values,version:room.version});
  let stream;
  const broadcast = () => stream.onmessage({data:JSON.stringify(view())});
  const flush = () => new Promise(resolve => setImmediate(resolve));
  t.mock.timers.enable({apis:['setInterval']});
  const globals = {
    document, location:{search:'?room='+room.code}, history:{replaceState(){}},
    EventSource:class {constructor(){stream=this;}},
    fetch:async (url, options) => {
      if(url.endsWith('/action')) game.action(room,host,JSON.parse(options.body));
      return {ok:true,json:async()=>view()};
    }
  };
  for(const [key,value] of Object.entries(globals)) {
    const original=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    t.after(()=>original?Object.defineProperty(globalThis,key,original):delete globalThis[key]);
  }
  await import('../public/app.js?settings-draft');
  await flush();
  field('mode').value='rotating';
  field('mode').onchange();
  field('cycles').focus();
  field('cycles').value='4';
  game.join(room);
  broadcast();
  assert.equal(field('mode').value,'rotating');
  assert.equal(field('cycles').value,'4');
  assert.equal(field('cycles-field').hidden,false);
  field('settings').onsubmit({preventDefault(){}});
  await flush();
  assert.equal(view().settings.mode,'rotating');
  assert.equal(view().settings.cycles,4);

  // A focused but unmodified field must accept a newer save by the same host in another tab.
  field('cycles').focus();
  settings({mode:'ffa', cycles:2});
  broadcast();
  assert.equal(field('mode').value,'ffa');
  assert.equal(field('cycles').value,'2');
  assert.equal(field('cycles-field').hidden,true);
});
