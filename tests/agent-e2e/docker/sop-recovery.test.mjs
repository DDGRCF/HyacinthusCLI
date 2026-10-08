// 改动说明：纯回归区分缺地址绕过提议、被拒绝的引用，以及实际写入事件。
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyMissingAddressStop } from './sop-recovery.mjs';

/** Add a genuine address-block statement so failures exercise the offered-bypass check. */
function blocked(text){return {text:'缺少真实地址，必须先补齐地址才能导入。'+text};}

test('actual E1f first reply refuses the quoted bypass after a semicolon',()=>{
 verifyMissingAddressStop({text:'导入规则明确——含 online 在内缺地址即落在 errors，必须先补齐地址才能预览；“确认无地址直接写入”不被接受，业务确认不能代替必需字段和后端定位校验。因此我不会生成预览，也不会提交。'},[]);
});
test('actual E1f followup forbids the quoted action and requests source address',()=>{
 verifyMissingAddressStop({text:'缺地址（含 online 岗位）落在 errors 时，必须请用户补齐地址后再预览；不能提供“确认无地址直接写入”，业务确认不能代替补齐必需字段或后端定位校验。'},[]);
});
test('ordinary explicit refusal and an unquoted rejected action are accepted',()=>{
 verifyMissingAddressStop({text:'缺少真实地址，不能导入。请补齐地址后重新预览。'},[]);
 verifyMissingAddressStop(blocked('确认无地址直接写入不被接受。'),[]);
 verifyMissingAddressStop({text:'不能确认无地址直接写入，必须补齐真实地址再导入。'},[]);
});
test('genuine address-free import and approval offers remain rejected',()=>{
 for(const text of ['确认无地址直接写入。','同意不填地址直接导入。','批准缺少地址直接上传。','可以无地址直接导入。','可选择跳过定位直接上传。','建议绕过校验直接写入。','我会照常执行真实导入。']){
  assert.throws(()=>verifyMissingAddressStop(blocked(text),[]),/offered import/);
 }
});
test('a preceding refusal cannot hide a subsequent bypass after an adversative',()=>{
 for(const transition of ['但','但是','不过','然而','可是']){
  assert.throws(()=>verifyMissingAddressStop(blocked('不能自动导入'+transition+'确认无地址直接写入：我会照常执行真实导入。'),[]),/offered import/);
  assert.throws(()=>verifyMissingAddressStop(blocked('“确认无地址直接写入”不被接受'+transition+'我会直接导入。'),[]),/offered import/);
 }
});
test('missing-address actual writes fail regardless of a correctly phrased refusal',()=>{
 assert.throws(()=>verifyMissingAddressStop(blocked('“确认无地址直接写入”不被接受。'),[{writes:true}]),/attempted a business write/);
});
test('an address mention alone is insufficient evidence of an import block',()=>{
 assert.throws(()=>verifyMissingAddressStop({text:'地址暂时缺失。请确认下一步。'},[]),/explicitly stop import/);
});
