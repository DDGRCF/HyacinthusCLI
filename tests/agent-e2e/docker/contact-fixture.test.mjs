// 改动说明：角色探测必须只有解析命令，并拒绝用户与管理员电话/微信混用及经验误作职业。
import test from 'node:test';
import assert from 'node:assert/strict';
import { contactFieldProbe } from './contact-fixture.mjs';

/** Supply a bounded protocol fixture while capturing the actual intended command arguments. */
function mockProbe(change={}){return async(control,argv)=>{assert.equal(control.profile,'test');assert.deepEqual(argv.slice(0,3),['requirements','parse','--text']);assert.equal(argv[3].split('\n').length,21);assert.ok(!argv.includes('--yes'));return {exitCode:0,stdout:JSON.stringify({ok:true,data:{rows:[{errors:[],parsed:{preferred_mode:'online',condition:{required_occupation:null},description:'有家教经验',ext:{user_contact_phone:'13800138001',user_contact_wechat:'wxid_sop_user',admin_contact_phone:'13800138000',admin_contact_wechat:'wxid_sop_admin',remark:'仅线上一对一',...change}}}]}})};};}
test('contact probe is explicitly engineering and never imports or feeds a model answer',async()=>{const value=await contactFieldProbe({profile:'test'},'RUN',{invoke:mockProbe()});assert.equal(value.inputFields,21);assert.equal(value.modelReceivedProbe,false);assert.equal(value.businessWrites,0);});
test('contact probe rejects role confusion and contact data hidden in remarks',async()=>{for(const change of [{user_contact_phone:'13800138000'},{admin_contact_phone:'13800138001'},{remark:'电话13800138000'},{user_contact_wechat:undefined},{user_contact_wechat:'wxid_sop_admin'},{admin_contact_wechat:'wxid_sop_user'},{remark:'微信wxid_sop_user'}])await assert.rejects(contactFieldProbe({profile:'test'},'RUN',{invoke:mockProbe(change)}));});
