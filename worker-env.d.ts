// worker/index.ts 跑在 Cloudflare Workers（nodejs_compat）里，
// 但 astro check 用的是浏览器侧 tsconfig，这里补最小类型声明，
// 避免 node:crypto / Cache API 报类型错误。

declare module 'node:crypto' {
  interface Hash {
    update(data: string | Uint8Array, encoding?: string): Hash;
    digest(encoding?: string): string | Buffer;
  }
  export function createHash(algorithm: string): Hash;
}
