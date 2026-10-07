// 改动说明：角色探测必须只有解析命令，并拒绝用户与管理员电话混用。
import test from 'node:test';
import assert from 'node:assert/strict';
import { contactFieldProbe } from './contact-fixture.mjs';

/** Supply a bounded protocol fixture while capturing the actual intended command arguments. */
function mockProbe(change={}){return async(control,argv)=>{assert.equal(control.profile,'test');assert.deepEqual(argv.slice(0,3),['requirements','parse','--text']);assert.equal(argv[3].split('\n').length,20);assert.ok(!argv.includes('--yes'));return {exitCode:0,stdout:JSON.stringify({ok:true,data:{rows:[{errors:[],parsed:{preferred_mode:'online',ext:{user_contact_phone:'13800138001',admin_contact_phone:'13800138000',admin_contact_wechat:'wxid_sop_admin',remark:'仅线上一对一',...change}}}]}})};};}
test('contact probe is explicitly engineering and never imports or feeds a model answer',async()=>{const value=await contactFieldProbe({profile:'test'},'RUN',{invoke:mockProbe()});assert.equal(value.inputFields,20);assert.equal(value.modelReceivedProbe,false);assert.equal(value.businessWrites,0);});
test('contact probe rejects role confusion and contact data hidden in remarks',async()=>{for(const change of [{user_contact_phone:'13800138000'},{admin_contact_phone:'13800138001'},{remark:'电话13800138000'}])await assert.rejects(contactFieldProbe({profile:'test'},'RUN',{invoke:mockProbe(change)}));});
