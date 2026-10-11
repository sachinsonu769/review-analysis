import {work as act, type Packet} from './lib';
import * as tools from './lib';
import {missing} from './absent';
export function use(value: Packet) { act(1); } // imported-call
export function namespaceUse() { tools.work(1); } // namespace-call
export function shadow(act: () => number) { return act(); } // parameter-shadow
export function local() { before(); function before() { return 4; } } // nested-local
missing(); // missing-source
