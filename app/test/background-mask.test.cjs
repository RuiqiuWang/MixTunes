'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { create, MASK_KEYS, OPACITY_KEY, BLUR_KEYS } = require('../ui/cover-background.js');
function fixture(values = {}, broken = false) {
  const map = new Map(Object.entries(values)), vars = new Map();
  const documentRoot = { getAttribute: () => documentRoot.theme, style: { setProperty: (k,v) => vars.set(k,v) }, classList: {add(){},remove(){}} };
  const container = {children:[],style:{setProperty(){}},getBoundingClientRect:()=>({width:960,height:680})};
  const controller = create({container,documentRoot,storage:{getItem:k=>map.get(k),setItem(k,v){if(broken)throw Error('denied');map.set(k,v);}}});
  return {controller,map,vars,documentRoot};
}
test('old users retain 88/90 masks without writing new settings', () => {
  const f=fixture(); assert.equal(f.controller.mask(),88);f.documentRoot.theme='dark';assert.equal(f.controller.mask(),90);
  assert.equal(f.map.size,0);assert.equal(f.vars.get('--background-mask-light'),'0.88');assert.equal(f.vars.get('--background-mask-dark'),'0.9');
});
test('mask endpoints, theme recall and reload are independent of opacity and blur', () => {
  const f=fixture({[OPACITY_KEY]:'41',[BLUR_KEYS.cover]:'24'});
  f.controller.setMask(0);assert.equal(f.vars.get('--background-mask-light'),'0');
  f.documentRoot.theme='dark';f.controller.setMask(100);assert.equal(f.vars.get('--background-mask-dark'),'1');
  f.documentRoot.theme='light';assert.equal(f.controller.mask(),0);
  assert.equal(f.map.get(OPACITY_KEY),'41');assert.equal(f.map.get(BLUR_KEYS.cover),'24');
  const next=fixture(Object.fromEntries(f.map));assert.equal(next.controller.mask(),0);next.documentRoot.theme='dark';assert.equal(next.controller.mask(),100);
});
test('invalid stored masks preserve defaults and input clamps to integer percentages', () => {
  for(const value of ['','bad','-1','101','Infinity']){const f=fixture({[MASK_KEYS.light]:value,[MASK_KEYS.dark]:value});assert.equal(f.controller.mask(),88);f.documentRoot.theme='dark';assert.equal(f.controller.mask(),90);}
  const f=fixture();f.controller.setMask(-10);assert.equal(f.controller.mask(),0);f.controller.setMask(200);assert.equal(f.controller.mask(),100);f.controller.setMask(25.6);assert.equal(f.controller.mask(),26);
});
test('storage failure leaves mask live while reporting that it was not saved', () => {
  const f=fixture({},true);assert.equal(f.controller.setMask(20),false);assert.equal(f.controller.mask(),20);assert.equal(f.vars.get('--background-mask-light'),'0.2');assert.equal(f.map.size,0);
});
