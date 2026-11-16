"""Optional Chromium regression test with fake Firebase only.
Run `python -m http.server 8792 --bind 127.0.0.1` from the repository,
then `python tests/special-sign-browser.py`. Requires Python Playwright and
Chromium (CHROMIUM_PATH may override /usr/bin/chromium).
No production Firestore or Storage writes are used.
"""
import os
from playwright.sync_api import sync_playwright, expect
import json
rows=[
 {'id':'a','hotel':'好六','item':'特處床單','qty':2,'status':'待摺疊','receivedDate':'2026-11-16','createdAt':'2026-11-16T01:00:00Z','round':1,'history':[]},
 {'id':'b','hotel':'文七','item':'特處床單','qty':3,'status':'待摺疊','receivedDate':'2026-11-16','createdAt':'2026-11-16T02:00:00Z','round':1,'history':[]},
 {'id':'c','hotel':'文七','item':'特處被套','qty':1,'status':'待摺疊','receivedDate':'2026-11-16','createdAt':'2026-11-16T03:00:00Z','round':1,'history':[]},
]
template=[{'baseName':'文七','hotel':'文七 特處','deptName':'特處','item':'特處被套'}, {'baseName':'文七','hotel':'文七 特處','deptName':'特處','item':'特處床單'}, {'baseName':'好六','hotel':'好六 特處','deptName':'特處','item':'特處床單'}]
fs='''
const state = window.__specialTest;
export const initializeFirestore=()=>({});
export const memoryLocalCache=()=>({});
export const doc=(db,collection,id)=>({collection,id});
export const collection=(db,name)=>name;
export const getDoc=async()=>({exists:()=>true,data:()=>({items:state.template,deliverySchedules:[]})});
export const getDocFromServer=getDoc;
export const onSnapshot=(ref,cb)=>{state.notify=()=>cb({docs:state.docs.map(d=>({id:d.id,data:()=>{const {id,...fields}=d;return fields}}))});state.notify();return ()=>{}};
export const runTransaction=async(db,fn)=>{const batch=writeBatch();await fn({get:async(ref)=>{const row=state.docs.find(d=>d.id===ref.id);return {exists:()=>Boolean(row),data:()=>({...row})}},set:batch.set});await batch.commit();};
export const writeBatch=()=>{const rows=[];return {set:(ref,fields)=>rows.push({id:ref.id,...fields}),commit:async()=>{state.attempts++;await new Promise(r=>setTimeout(r,1200));if(state.failNext){state.failNext=false;throw new Error('測試連線失敗，未儲存')}for(const row of rows){const i=state.docs.findIndex(d=>d.id===row.id);if(i<0)state.docs.push(row);else state.docs[i]=row;}state.commits++;state.notify();}}};
'''
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':430,'height':932},ignore_https_errors=True)
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script('window.__specialTest='+json.dumps({'docs':rows,'template':template,'attempts':0,'commits':0,'uploads':0})+';')
 def modules(route):
  url=route.request.url
  if 'firebase-app.js' in url: source='export const initializeApp=()=>({});'
  elif 'firebase-firestore.js' in url: source=fs
  else: source="export const getStorage=()=>({});export const ref=()=>({});export const uploadString=async()=>{window.__specialTest.uploads++;};export const getDownloadURL=async()=>{return 'unused';};"
  route.fulfill(status=200,content_type='application/javascript',body=source)
 page.route('https://www.gstatic.com/firebasejs/10.13.0/*',modules)
 page.route('https://firestore.googleapis.com/**',lambda r:r.abort())
 page.route('https://firebasestorage.googleapis.com/**',lambda r:r.abort())
 page.goto('http://127.0.0.1:8792/special.html')
 expect(page.locator('#configStatus')).to_have_text('飯店 2 間')
 expect(page.locator('#cardScroller [data-action=open-item]').first).to_have_attribute('data-id','c')
 assert page.locator('#cardScroller [data-action=open-item]').evaluate_all('(nodes)=>nodes.map(n=>n.dataset.id)')==['c','b','a']
 def draw():
  pad=page.locator('#foldCanvas');pad.scroll_into_view_if_needed();box=pad.bounding_box()
  page.mouse.move(box['x']+20,box['y']+35);page.mouse.down();page.mouse.move(box['x']+100,box['y']+85,steps=8);page.mouse.up()
 page.locator('[data-action=open-item][data-id=b]').click()
 draw()
 page.locator('[data-action=confirm-sign]').click()
 expect(page.locator('[data-action=confirm-sign]')).to_be_disabled()
 expect(page.locator('[data-action=confirm-sign]')).to_contain_text('儲存中')
 page.evaluate("""()=>{for(const selector of ['[data-action=confirm-sign]','[data-action=close-popup]','[data-action=open-item][data-id=a]'])document.querySelector(selector).dispatchEvent(new MouseEvent('click',{bubbles:true}));}""")
 expect(page.locator('#popupTitle')).to_contain_text('文七')
 expect(page.locator('[data-testid=save-success]')).to_be_visible()
 assert page.evaluate('window.__specialTest.commits')==1
 assert page.evaluate('window.__specialTest.uploads')==0
 assert page.evaluate("window.__specialTest.docs.find(d=>d.id==='a').status")=='待摺疊'
 expect(page.locator('#itemPopup')).to_be_visible()
 page.locator('[data-action=close-popup]').click()
 page.evaluate("document.querySelector('[data-action=open-item][data-id=a]').dispatchEvent(new MouseEvent('click',{bubbles:true}))")
 expect(page.locator('#itemPopup')).to_be_hidden()
 page.wait_for_timeout(750)
 page.locator('[data-action=open-item][data-id=b]').click()
 expect(page.locator('[data-action=confirm-rework]')).to_be_visible()
 page.locator('[data-reason="髒污"]').click()
 page.locator('[data-action=confirm-rework]').click()
 expect(page.locator('[data-testid=save-success]')).to_contain_text('已退回重工')
 assert page.evaluate("window.__specialTest.docs.find(d=>d.id==='b').status")=='重工中'
 assert page.evaluate("window.__specialTest.docs.find(d=>d.id==='b').foldSignature") == ''
 page.locator('[data-action=close-popup]').click();page.wait_for_timeout(750)
 page.locator('[data-action=open-item][data-id=a]').click();draw()
 page.evaluate('window.__specialTest.failNext=true')
 page.locator('[data-action=confirm-sign]').click()
 expect(page.locator('[data-action=confirm-sign]')).to_be_enabled(timeout=5000)
 expect(page.locator('#toast')).to_contain_text('測試連線失敗')
 expect(page.locator('#popupTitle')).to_contain_text('好六')
 assert page.evaluate("window.__specialTest.docs.find(d=>d.id==='a').status")=='待摺疊'
 assert page.locator('[data-testid=save-success]').count()==0
 page.evaluate("window.__specialTest.docs.find(d=>d.id==='a').status='已送出'")
 page.locator('[data-action=confirm-sign]').click()
 expect(page.locator('#toast')).to_contain_text('已被其他人更新')
 assert page.evaluate("window.__specialTest.docs.find(d=>d.id==='a').status")=='已送出'
 assert page.evaluate('window.__specialTest.commits')==2
 assert not errors,errors
 print('PASS: template order, pending lock, rapid repeated clicks stay on original hotel, one commit/no Storage, success acknowledgement, signed rework, failed write retains target/signature; concurrent send cannot be overwritten')
 browser.close()
