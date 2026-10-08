import test from 'node:test'
import assert from 'node:assert/strict'
import { flightEvents } from '../src/flight-events.mjs'
const flight={id:'abc',callSign:'CHX30',type:'RTH',status:'Im Flug'}
test('first snapshot and reconnect do not flood notifications',()=>assert.deepEqual(flightEvents(null,[flight]),[]))
test('new rescue flight reported once; unchanged snapshot silent',()=>{
  assert.equal(flightEvents([],[flight]).length,1)
  assert.deepEqual(flightEvents([flight],[flight]),[])
})
test('loss of coverage never treated as landing; ground must be explicit',()=>{
  assert.deepEqual(flightEvents([flight],[]),[])
  assert.match(flightEvents([flight],[{...flight,status:'Am Boden'}])[0].title,/Bodenstatus/)
  assert.deepEqual(flightEvents([],[{...flight,type:'HELI'}]),[])
})
