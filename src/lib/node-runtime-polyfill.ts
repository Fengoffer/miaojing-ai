import { AsyncLocalStorage } from 'async_hooks';

type NodeGlobalWithAsyncLocalStorage = typeof globalThis & {
  AsyncLocalStorage?: typeof AsyncLocalStorage;
};

const nodeGlobal = globalThis as NodeGlobalWithAsyncLocalStorage;

if (typeof nodeGlobal.AsyncLocalStorage === 'undefined') {
  nodeGlobal.AsyncLocalStorage = AsyncLocalStorage;
}
