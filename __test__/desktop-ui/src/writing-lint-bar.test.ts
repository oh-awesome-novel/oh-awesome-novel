// @vitest-environment happy-dom
import {mount,flushPromises} from '@vue/test-utils';
import {beforeEach,describe,it,expect,vi} from 'vite-plus/test';
import WritingLintBar from '../../../apps/desktop-ui/src/components/editor/WritingLintBar.vue';
const mocks=vi.hoisted(()=>({scanNovelLint:vi.fn(),reviewNovelLint:vi.fn(),proposeNovelLint:vi.fn()}));
vi.mock('../../../apps/desktop-ui/src/client',()=>({oanClient:mocks}));
const sourceHash='a'.repeat(64),hit={hitId:'h',anchorId:'p',original:'仿佛',name:'模糊词',line:1,suggestionHint:'明确动作'};
beforeEach(()=>{vi.clearAllMocks();mocks.scanNovelLint.mockResolvedValue({sourceHash,anchors:[],hits:[hit]});mocks.reviewNovelLint.mockResolvedValue({sourceHash,replacements:[{hitId:'h',anchorId:'p',original:'仿佛',suggestion:'确实'}]});mocks.proposeNovelLint.mockResolvedValue({pendingAction:{id:'pa_lint'}});});
describe('Writing LINT human selection',()=>{
 it('scans, highlights and submits only author-selected suggestions to approval',async()=>{
  const wrapper=mount(WritingLintBar,{props:{path:'chapters/0001/0001.md',workspaceRoot:'/novel'}});
  await wrapper.findAll('button')[0]!.trigger('click');await flushPromises();expect(wrapper.find('mark').text()).toBe('仿佛');
  await wrapper.findAll('button')[1]!.trigger('click');await flushPromises();expect(wrapper.find('ins').text()).toBe('确实');
  await wrapper.find('input[type=checkbox]').setValue(false);expect(wrapper.find('fieldset button').attributes('disabled')).toBeDefined();
  await wrapper.find('input[type=checkbox]').setValue(true);await wrapper.find('fieldset button').trigger('click');await flushPromises();
  expect(mocks.proposeNovelLint.mock.calls[0]![0].replacements).toHaveLength(1);expect(wrapper.emitted('reviewPendingAction')).toEqual([['pa_lint']]);
 });
 it('cancels pending scan and clears another file’s evidence on selection change',async()=>{
  let resolve:(value:unknown)=>void=()=>{};mocks.scanNovelLint.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const wrapper=mount(WritingLintBar,{props:{path:'chapters/0001/0001.md',workspaceRoot:'/novel'}});
  await wrapper.findAll('button')[0]!.trigger('click');await wrapper.findAll('button').find(button=>button.text()==='取消')!.trigger('click');
  resolve({sourceHash,hits:[hit],anchors:[]});await flushPromises();expect(wrapper.find('mark').exists()).toBe(false);
  expect(mocks.scanNovelLint.mock.calls[0]![1].signal.aborted).toBe(true);
  await wrapper.setProps({path:'chapters/0001/0002.md'});expect(wrapper.find('fieldset').exists()).toBe(false);
 });
 it('shows stale revision errors without submitting replacements',async()=>{
  mocks.scanNovelLint.mockRejectedValue(new Error('Source changed; scan again.'));
  const wrapper=mount(WritingLintBar,{props:{path:'chapters/0001/0001.md',workspaceRoot:'/novel'}});await wrapper.findAll('button')[0]!.trigger('click');await flushPromises();expect(wrapper.find('[role=alert]').text()).toContain('Source changed');expect(mocks.proposeNovelLint).not.toHaveBeenCalled();
 });
});
