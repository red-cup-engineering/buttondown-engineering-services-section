import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buttondownKeyDriver } from "../src/obligation-driver.mjs";

const source=Object.freeze({
 recordKind:"group-human-handoff",handoffId:"buttondown-sigridsong-api-key",
 interactionKind:"buttondown-api-key",expectedOutcome:{newsletterHandle:"sigridsong"},
});
test("original Buttondown driver receives named typed newsletter and keeps accepted fixture key only in credential custody",async t=>{
 const root=mkdtempSync(join(tmpdir(),"buttondown-typed-handoff-"));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const env={CREDENTIALS_DIRECTORY:join(root,"credentials")};
 const token="testfixtureABCDEFGHIJKLMNOP1234567890";
 const fetch=async(url,request)=>{
  assert.equal(request.method,"GET");
  assert.match(String(url),/\/newsletters$/u);
  assert.equal(request.headers.authorization,"Token "+token);
  return new Response(JSON.stringify({results:[{id:"newsletter-1",username:"sigridsong",name:"Test"}]}),{status:200});
 };
 const driver=buttondownKeyDriver({env,fetch});
 const [instance]=driver.instances(source);
 assert.equal(instance.id,source.handoffId);
 assert.deepEqual(instance.vars,{newsletter:"sigridsong"});
 assert.equal(await driver.held(source),false);
 const receipt=await driver.capture(source,instance,{},token);
 assert.ok(receipt.custody);
 assert.ok(existsSync(receipt.custody));
 assert.equal(readFileSync(receipt.custody,"utf8").trim(),token);
 assert.equal(statSync(receipt.custody).mode&0o777,0o600);
 assert.equal(await driver.held(source),true);
});
test("wrong Buttondown provider identity cannot put a secret into the original custodian",async t=>{
 const root=mkdtempSync(join(tmpdir(),"buttondown-typed-handoff-refusal-"));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const env={CREDENTIALS_DIRECTORY:join(root,"credentials")};
 const driver=buttondownKeyDriver({env,fetch:async()=>new Response(JSON.stringify({results:[{id:"bad",username:"other-person"}]}),{status:200})});
 await assert.rejects(driver.capture(source,{id:source.handoffId},{},
    "fixtureWrongNewsletterKey1234567890"),/belongs to the newsletter/u);
 assert.equal(await driver.held(source),false);
});
