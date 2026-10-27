// @vitest-environment happy-dom
import {mount} from '@vue/test-utils';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vite-plus/test';
import FileViewer from '../../../apps/desktop-ui/src/components/workspace/FileViewer.vue';
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
describe('live local manuscript LINT highlights',()=>{
  it('debounces inline marks and preserves literal HTML and manuscript bytes',async()=>{
    const content='# 开场\n\n<script>alert(1)</script>她仿佛听见声音。';
    const wrapper=mount(FileViewer,{props:{path:'chapters/0001/0001.md',content,loading:false}});
    expect(wrapper.find('.novel-lint-hit').exists()).toBe(false);await vi.advanceTimersByTimeAsync(181);
    expect(wrapper.find('.novel-lint-hit').text()).toBe('仿佛');expect(wrapper.find('.novel-lint-hit').attributes('title')).toContain('模糊词');
    expect(wrapper.get('pre').text()).toBe(content);expect(wrapper.find('script').exists()).toBe(false);
    await wrapper.get('input[type=checkbox]').setValue(false);expect(wrapper.find('.novel-lint-hit').exists()).toBe(false);expect(wrapper.get('pre').text()).toBe(content);wrapper.unmount();
  });
  it('removes stale highlights immediately and scans the latest refreshed source only',async()=>{
    const wrapper=mount(FileViewer,{props:{path:'chapters/0001/0001.md',content:'仿佛',loading:false}});await vi.advanceTimersByTimeAsync(181);expect(wrapper.findAll('.novel-lint-hit')).toHaveLength(1);
    await wrapper.setProps({content:'她走进门。'});expect(wrapper.find('.novel-lint-hit').exists()).toBe(false);
    await wrapper.setProps({path:'chapters/0001/0002.md',content:'嘴角微微上扬'});await vi.advanceTimersByTimeAsync(181);expect(wrapper.find('.novel-lint-hit').text()).toBe('嘴角微微上扬');
    await wrapper.setProps({path:'.oan/config.yaml',content:'仿佛'});await vi.advanceTimersByTimeAsync(181);expect(wrapper.find('.novel-lint-hit').exists()).toBe(false);wrapper.unmount();
  });
  it('preserves search target line and marks phrases inside and outside it',async()=>{
    const content='仿佛\n她嘴角微微上扬。\n像只小兽。';const wrapper=mount(FileViewer,{props:{path:'characters/aria/profile.md',content,line:2,loading:false}});await vi.advanceTimersByTimeAsync(181);
    expect(wrapper.get('mark[data-line="2"]').text()).toBe('她嘴角微微上扬。');expect(wrapper.get('mark[data-line="2"] .novel-lint-hit').text()).toBe('嘴角微微上扬');expect(wrapper.get('pre').text()).toBe(content);expect(wrapper.findAll('.novel-lint-hit')).toHaveLength(3);wrapper.unmount();
  });
  it('cancels scheduled scanning when loading fails or the viewer unmounts',async()=>{
    const wrapper=mount(FileViewer,{props:{path:'world/rules.md',content:'仿佛',loading:false}});await wrapper.setProps({error:'读取失败'});await vi.advanceTimersByTimeAsync(181);expect(wrapper.find('pre').exists()).toBe(false);wrapper.unmount();expect(vi.getTimerCount()).toBe(0);
  });
});
