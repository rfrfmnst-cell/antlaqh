import {test} from 'node:test';
import assert from 'node:assert/strict';
import {phone} from '../lib/security.js';
test('mobile identifiers normalize local, international and Arabic forms',()=>{
  for(const input of ['0553575760','+966553575760','966553575760','00966553575760','٠٥٥٣٥٧٥٧٦٠']) assert.equal(phone(input),'+966553575760');
  for(const input of ['bad','123','+000000000000','0553575760<script>']) assert.throws(()=>phone(input));
});
