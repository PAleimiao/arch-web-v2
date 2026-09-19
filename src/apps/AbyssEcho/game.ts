/* ============================================================
 * 《深渊回响》引擎层
 * 纯 canvas 渲染（含 HUD / 对话 / 商店 / 菜单），React 只做壳。
 * 主循环 rAF + 可变步长（dt 上限 50ms）。
 * ============================================================ */

import {
  ARMORS,
  ENEMY_BASE,
  MAP_H,
  MAP_W,
  POTION_HEAL,
  POTION_PRICE,
  TILE,
  VIEW_H,
  VIEW_W,
  WEAPONS,
  ZONES,
  isSolid,
  questTitle,
  SLIME_TARGET,
  type ChestDef,
  type EnemyKind,
  type NpcLook,
  type QuestState,
  type ZoneDef,
  type ZoneId,
} from './data';
import {
  drawCoin,
  drawEnemy as drawEnemyArt,
  drawHero,
  drawNpc as drawNpcArt,
  drawPotion,
  drawTile,
  rect as rect2,
  PAL,
} from './art';

/* ----------------------------- 存档 ----------------------------- */

const SAVE_KEY = 'arch-web-abyss:save';

interface SaveData {
  quest: QuestState;
  zone: ZoneId;
  px: number;
  py: number;
  hp: number;
  lvl: number;
  xp: number;
  gold: number;
  potions: number;
  weapon: number;
  armor: number;
  opened: string[];
  guardDead: boolean;
  kills: number;
  sfxOn: boolean;
  metGuide: boolean;
  metHunter: boolean;
  bossIntroDone: boolean;
}

function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (!ZONES[d.zone]) return null;
    if (!d.quest || typeof d.quest.stage !== 'number') return null;
    return d;
  } catch {
    return null;
  }
}

function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

/* ----------------------------- 音效 ----------------------------- */

class Sfx {
  private ac: AudioContext | null = null;
  on = true;

  private ctx(): AudioContext | null {
    if (!this.on) return null;
    if (!this.ac) {
      try {
        this.ac = new AudioContext();
      } catch {
        return null;
      }
    }
    if (this.ac.state === 'suspended') void this.ac.resume();
    return this.ac;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol = 0.12, slide = 0) {
    const ac = this.ctx();
    if (!ac) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ac.currentTime + dur);
    gain.gain.setValueAtTime(vol, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + dur);
  }

  hit() { this.tone(220, 0.08, 'square', 0.1, -120); }
  hurt() { this.tone(140, 0.18, 'sawtooth', 0.14, -70); }
  coin() { this.tone(880, 0.07, 'square', 0.08); setTimeout(() => this.tone(1320, 0.09, 'square', 0.08), 60); }
  level() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.12, 'square', 0.1), i * 90)); }
  potion() { this.tone(520, 0.15, 'sine', 0.12, 260); }
  select() { this.tone(660, 0.05, 'square', 0.06); }
  die() { this.tone(200, 0.5, 'sawtooth', 0.15, -150); }
  roar() { this.tone(80, 0.6, 'sawtooth', 0.2, 40); }
}

/* ----------------------------- 实体 ----------------------------- */

interface Player {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  lvl: number;
  xp: number;
  gold: number;
  potions: number;
  weapon: number;
  armor: number;
  facing: 'up' | 'down' | 'left' | 'right';
  anim: number;
  moving: boolean;
  attackCd: number;
  swing: number;
  iframes: number;
  atkBase: number;
  defBase: number;
}

interface Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  spawnKey: string;
  permanent: boolean;
  dead: boolean;
  respawnT: number;
  hitT: number;
  atkCd: number;
  aiT: number;
  vx: number;
  vy: number;
  flash: number;
  summoned?: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
}

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  dmg: number;
}

interface Drop {
  kind: 'gold' | 'heart' | 'potion';
  x: number;
  y: number;
  value: number;
  vx: number;
  vy: number;
  t: number;
}

type GameState = 'title' | 'playing' | 'dialog' | 'shop' | 'paused' | 'dead' | 'ending';

interface DialogPage {
  name: string;
  title?: string;
  look?: NpcLook;
  hair?: string;
  dress?: string;
  lines: string[];
}

const XP_NEED = (lvl: number) => Math.floor(28 * Math.pow(lvl, 1.4));

function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW) {
      out.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) out.push(line);
  return out;
}

/* ============================================================ */

export class AbyssGame {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private lastT = 0;
  private running = false;

  private keys = new Set<string>();
  private pressed = new Set<string>();

  private state: GameState = 'title';
  private zone: ZoneDef = ZONES.village;
  private player!: Player;
  private quest: QuestState = { stage: 0, slimeKills: 0, hasKey: false, bossDead: false };
  private enemies: Enemy[] = [];
  private particles: Particle[] = [];
  private floats: FloatText[] = [];
  private projectiles: Projectile[] = [];
  private drops: Drop[] = [];
  private opened = new Set<string>();
  private guardDead = false;
  private bossDead = false;
  private kills = 0;
  /** 一次性剧情标记 */
  private metGuide = false;
  private metHunter = false;
  private bossIntroDone = false;

  private camX = 0;
  private camY = 0;
  private shake = 0;
  private fade = 1;
  private fadeDir = -1;
  private zoneLabelT = 0;
  private time = 0;

  private dialog: DialogPage[] = [];
  private dialogIdx = 0;
  private onDialogEnd: (() => void) | null = null;
  private shopFlavor = '';

  private shopIdx = 0;
  private pauseIdx = 0;
  private titleIdx = 0;
  private titleHelp = false;
  private deadT = 0;
  private endStats = '';

  private sfx = new Sfx();
  private hasSave: SaveData | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d 不可用');
    this.ctx = ctx;
    this.hasSave = loadSave();
  }

  /* ------------------------- 生命周期 ------------------------- */

  start() {
    if (this.running) return;
    this.running = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  /** 窗口失焦：清空按键，游玩中自动暂停 */
  suspend() {
    this.keys.clear();
    this.pressed.clear();
    if (this.state === 'playing') {
      this.state = 'paused';
      this.pauseIdx = 0;
    }
  }

  private loop = (t: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    this.time += dt;
    this.update(dt);
    this.draw();
    this.pressed.clear();
    this.raf = requestAnimationFrame(this.loop);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (
      ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'j', 'k', 'e', 'w', 'a', 's', 'd'].includes(k)
    ) {
      e.preventDefault();
    }
    if (!this.keys.has(k)) this.pressed.add(k);
    this.keys.add(k);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private just(...keys: string[]): boolean {
    return keys.some((k) => this.pressed.has(k));
  }

  private down(...keys: string[]): boolean {
    return keys.some((k) => this.keys.has(k));
  }

  /* ------------------------- 数值 ------------------------- */

  private atkTotal(): number {
    return this.player.atkBase + WEAPONS[this.player.weapon].atk;
  }

  private defTotal(): number {
    return this.player.defBase + ARMORS[this.player.armor].def;
  }

  private newXpNeed(): number {
    return XP_NEED(this.player.lvl);
  }

  /* ------------------------- 存档 ------------------------- */

  private save() {
    const d: SaveData = {
      quest: { ...this.quest },
      zone: this.zone.id,
      px: Math.round(this.player.x),
      py: Math.round(this.player.y),
      hp: Math.ceil(this.player.hp),
      lvl: this.player.lvl,
      xp: this.player.xp,
      gold: this.player.gold,
      potions: this.player.potions,
      weapon: this.player.weapon,
      armor: this.player.armor,
      opened: [...this.opened],
      guardDead: this.guardDead,
      kills: this.kills,
      sfxOn: this.sfx.on,
      metGuide: this.metGuide,
      metHunter: this.metHunter,
      bossIntroDone: this.bossIntroDone,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(d));
      this.hasSave = d;
    } catch {
      /* ignore */
    }
  }

  /* ------------------------- 开局 / 读档 ------------------------- */

  private basePlayer(): Player {
    return {
      x: 10 * TILE,
      y: 12 * TILE,
      hp: 100,
      maxHp: 100,
      lvl: 1,
      xp: 0,
      gold: 30,
      potions: 2,
      weapon: 0,
      armor: 0,
      facing: 'down',
      anim: 0,
      moving: false,
      attackCd: 0,
      swing: 0,
      iframes: 0,
      atkBase: 10,
      defBase: 0,
    };
  }

  private newGame() {
    this.player = this.basePlayer();
    this.quest = { stage: 0, slimeKills: 0, hasKey: false, bossDead: false };
    this.opened = new Set();
    this.guardDead = false;
    this.bossDead = false;
    this.kills = 0;
    this.metGuide = false;
    this.metHunter = false;
    this.bossIntroDone = false;
    this.enterZone('village', 10 * TILE, 12 * TILE, true);
    this.state = 'playing';
    this.sfx.on = true;
    this.save();
  }

  private continueGame() {
    const d = this.hasSave;
    if (!d) return;
    this.player = this.basePlayer();
    this.player.lvl = d.lvl;
    this.player.xp = d.xp;
    this.player.gold = d.gold;
    this.player.potions = d.potions;
    this.player.weapon = d.weapon;
    this.player.armor = d.armor;
    this.player.maxHp = 100 + (d.lvl - 1) * 15;
    this.player.hp = Math.min(d.hp, this.player.maxHp);
    this.player.atkBase = 10 + (d.lvl - 1) * 2;
    this.player.defBase = d.lvl - 1;
    this.quest = { ...d.quest };
    this.opened = new Set(d.opened);
    this.guardDead = d.guardDead;
    this.bossDead = d.quest.bossDead;
    this.kills = d.kills;
    this.metGuide = d.metGuide;
    this.metHunter = d.metHunter;
    this.bossIntroDone = d.bossIntroDone;
    this.sfx.on = d.sfxOn;
    this.enterZone(d.zone, d.px, d.py, true);
    this.state = 'playing';
  }

  /* ------------------------- 区域切换 ------------------------- */

  private enterZone(id: ZoneId, px: number, py: number, instant = false) {
    this.zone = ZONES[id];
    this.player.x = px;
    this.player.y = py;
    this.enemies = [];
    this.projectiles = [];
    this.drops = [];
    this.particles = [];
    this.floats = [];

    for (const s of this.zone.spawns) {
      const key = `${id}:${s.tx},${s.ty}`;
      if (s.kind === 'guard' && this.guardDead) continue;
      if (s.kind === 'boss' && this.bossDead) continue;
      this.spawnEnemy(s.kind, s.tx * TILE + TILE / 2, s.ty * TILE + TILE / 2, key, !s.respawn);
    }

    this.camX = this.clampCam(this.player.x - VIEW_W / 2, (MAP_W * TILE) - VIEW_W);
    this.camY = this.clampCam(this.player.y - VIEW_H / 2, (MAP_H * TILE) - VIEW_H);
    this.zoneLabelT = 2.6;
    this.fade = instant ? 1 : 0;
    this.fadeDir = instant ? -1 : 0;
  }

  private spawnEnemy(kind: EnemyKind, x: number, y: number, spawnKey: string, permanent: boolean) {
    const b = ENEMY_BASE[kind];
    this.enemies.push({
      kind,
      x,
      y,
      hp: b.hp,
      maxHp: b.hp,
      spawnKey,
      permanent,
      dead: false,
      respawnT: 0,
      hitT: 0,
      atkCd: 0,
      aiT: Math.random() * 2,
      vx: 0,
      vy: 0,
      flash: 0,
    });
  }

  private clampCam(v: number, max: number): number {
    if (max <= 0) return 0;
    return Math.max(0, Math.min(max, v));
  }

  /* ------------------------- 更新 ------------------------- */

  private update(dt: number) {
    if (this.fadeDir !== 0 || (this.fade > 0 && this.fade < 1)) {
      this.fade += this.fadeDir * dt * 4;
      if (this.fade >= 1 && this.fadeDir > 0) {
        this.fade = 1;
        this.fadeDir = -1;
        // 淡出到黑时执行挂起的传送
        if (this.pendingZone) {
          const p = this.pendingZone;
          this.pendingZone = null;
          this.enterZone(p.to, p.px, p.py);
          this.save();
        }
      }
      if (this.fade <= 0 && this.fadeDir < 0) {
        this.fade = 0;
        this.fadeDir = 0;
      }
    }

    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 30);

    switch (this.state) {
      case 'title': this.updateTitle(); break;
      case 'playing': this.updatePlaying(dt); break;
      case 'dialog': this.updateDialog(); break;
      case 'shop': this.updateShop(); break;
      case 'paused': this.updatePaused(); break;
      case 'dead': this.updateDead(); break;
      case 'ending': this.updateEnding(); break;
    }

    // 粒子与飘字在任何状态下都走
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 140 * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floats) {
      f.y -= 34 * dt;
      f.life -= dt;
    }
    this.floats = this.floats.filter((f) => f.life > 0);
    if (this.zoneLabelT > 0) this.zoneLabelT -= dt;
  }

  private pendingZone: { to: ZoneId; px: number; py: number } | null = null;

  private updateTitle() {
    const items = this.hasSave ? 2 : 1;
    if (this.just('w', 'arrowup')) { this.titleIdx = (this.titleIdx + items - 1) % items; this.sfx.select(); }
    if (this.just('s', 'arrowdown')) { this.titleIdx = (this.titleIdx + 1) % items; this.sfx.select(); }
    if (this.just('e', 'enter', 'j', ' ')) {
      if (this.titleIdx === 0) this.newGame();
      else this.continueGame();
    }
    if (this.just('h')) this.titleHelp = !this.titleHelp;
  }

  private updateDialog() {
    if (this.just('e', 'enter', 'j', ' ')) {
      this.dialogIdx++;
      if (this.dialogIdx >= this.dialog.length) {
        const cb = this.onDialogEnd;
        this.dialog = [];
        this.dialogIdx = 0;
        this.onDialogEnd = null;
        this.state = 'playing';
        cb?.();
      }
    }
  }

  private updateShop() {
    const items = this.shopItems();
    if (this.just('escape', 'e')) { this.state = 'playing'; return; }
    if (this.just('w', 'arrowup')) { this.shopIdx = (this.shopIdx + items.length - 1) % items.length; this.sfx.select(); }
    if (this.just('s', 'arrowdown')) { this.shopIdx = (this.shopIdx + 1) % items.length; this.sfx.select(); }
    if (this.just('j', 'enter', ' ')) this.buyItem(items[this.shopIdx]);
  }

  private updatePaused() {
    if (this.just('escape')) { this.state = 'playing'; return; }
    if (this.just('w', 'arrowup')) { this.pauseIdx = (this.pauseIdx + 3) % 4; this.sfx.select(); }
    if (this.just('s', 'arrowdown')) { this.pauseIdx = (this.pauseIdx + 1) % 4; this.sfx.select(); }
    if (this.just('j', 'enter', ' ')) {
      switch (this.pauseIdx) {
        case 0: this.state = 'playing'; break;
        case 1: this.save(); this.floats.push({ x: this.player.x, y: this.player.y - 24, text: '已保存', life: 1.2, color: '#8fd4a0' }); break;
        case 2: this.sfx.on = !this.sfx.on; break;
        case 3: this.save(); this.state = 'title'; this.titleIdx = 0; break;
      }
    }
  }

  private updateDead() {
    this.deadT += 0.016;
    if (this.deadT > 0.8 && this.just('enter', 'e', 'j', ' ')) {
      // 复活：回村子，掉 25% 金币
      this.player.gold = Math.floor(this.player.gold * 0.75);
      this.player.hp = this.player.maxHp;
      this.enterZone('village', 10 * TILE, 12 * TILE, true);
      this.state = 'playing';
    }
  }

  private updateEnding() {
    if (this.just('escape', 'enter', 'e')) {
      clearSave();
      this.hasSave = null;
      this.state = 'title';
      this.titleIdx = 0;
    }
  }

  /* ------------------------- 游玩逻辑 ------------------------- */

  private updatePlaying(dt: number) {
    if (this.just('escape')) { this.state = 'paused'; this.pauseIdx = 0; return; }

    const p = this.player;
    p.attackCd = Math.max(0, p.attackCd - dt);
    p.swing = Math.max(0, p.swing - dt);
    p.iframes = Math.max(0, p.iframes - dt);

    /* 移动 */
    let dx = 0;
    let dy = 0;
    if (this.down('a', 'arrowleft')) dx -= 1;
    if (this.down('d', 'arrowright')) dx += 1;
    if (this.down('w', 'arrowup')) dy -= 1;
    if (this.down('s', 'arrowdown')) dy += 1;
    p.moving = dx !== 0 || dy !== 0;
    if (p.moving) {
      if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }
      if (Math.abs(dx) > Math.abs(dy)) p.facing = dx > 0 ? 'right' : 'left';
      else p.facing = dy > 0 ? 'down' : 'up';
      const spd = 95;
      this.moveEntity(p, dx * spd * dt, dy * spd * dt, 10);
      p.anim += dt * 8;
    }

    /* 攻击 */
    if (this.just('j', ' ', 'z') && p.attackCd <= 0) {
      p.attackCd = 0.42;
      p.swing = 0.16;
      this.sfx.hit();
      this.doMeleeHit();
    }

    /* 喝药 */
    if (this.just('k')) this.drinkPotion();

    /* 交互 */
    if (this.just('e', 'enter')) this.tryInteract();

    /* 传送点 */
    this.checkPortals();

    /* 敌人 */
    for (const e of this.enemies) {
      if (e.dead) {
        if (!e.permanent) {
          e.respawnT -= dt;
          if (e.respawnT <= 0) {
            const [tx, ty] = e.spawnKey.split(':').slice(1).join(':').split(',').map(Number);
            e.x = tx * TILE + TILE / 2;
            e.y = ty * TILE + TILE / 2;
            e.hp = e.maxHp;
            e.dead = false;
          }
        }
        continue;
      }
      e.hitT = Math.max(0, e.hitT - dt);
      e.atkCd = Math.max(0, e.atkCd - dt);
      e.aiT -= dt;
      this.updateEnemy(e, dt);
    }

    /* 掉落物 */
    for (const d of this.drops) {
      d.t += dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vx *= 0.9;
      d.vy *= 0.9;
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      if (dist < 60) {
        d.x += ((p.x - d.x) / dist) * 120 * dt;
        d.y += ((p.y - d.y) / dist) * 120 * dt;
      }
      if (dist < 18) {
        d.t = -1;
        if (d.kind === 'gold') {
          p.gold += d.value;
          this.sfx.coin();
          this.floats.push({ x: d.x, y: d.y - 10, text: `+${d.value}`, life: 0.8, color: '#f0d060' });
        } else if (d.kind === 'heart') {
          p.hp = Math.min(p.maxHp, p.hp + 15);
          this.sfx.potion();
        } else {
          p.potions++;
          this.sfx.coin();
          this.floats.push({ x: d.x, y: d.y - 10, text: '获得药水', life: 1, color: '#e88' });
        }
      }
    }
    this.drops = this.drops.filter((d) => d.t >= 0);

    /* 弹幕 */
    for (const b of this.projectiles) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      const tx = Math.floor(b.x / TILE);
      const ty = Math.floor(b.y / TILE);
      if (isSolid(this.zone, tx, ty)) b.life = 0;
      if (
        p.iframes <= 0 &&
        Math.hypot(b.x - p.x, b.y - p.y) < 12
      ) {
        this.damagePlayer(b.dmg);
        b.life = 0;
      }
    }
    this.projectiles = this.projectiles.filter((b) => b.life > 0);

    /* 相机 */
    const targetX = this.clampCam(p.x - VIEW_W / 2, MAP_W * TILE - VIEW_W);
    const targetY = this.clampCam(p.y - VIEW_H / 2, MAP_H * TILE - VIEW_H);
    this.camX += (targetX - this.camX) * Math.min(1, dt * 6);
    this.camY += (targetY - this.camY) * Math.min(1, dt * 6);
  }

  private moveEntity(ent: { x: number; y: number }, dx: number, dy: number, r: number) {
    const tryAxis = (nx: number, ny: number) => {
      const minX = Math.floor((nx - r) / TILE);
      const maxX = Math.floor((nx + r) / TILE);
      const minY = Math.floor((ny - r) / TILE);
      const maxY = Math.floor((ny + r) / TILE);
      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          if (isSolid(this.zone, tx, ty)) return false;
        }
      }
      return true;
    };
    if (dx !== 0 && tryAxis(ent.x + dx, ent.y)) ent.x += dx;
    if (dy !== 0 && tryAxis(ent.x, ent.y + dy)) ent.y += dy;
  }

  private doMeleeHit() {
    const p = this.player;
    const reach = 30;
    const cx = p.x + (p.facing === 'left' ? -reach : p.facing === 'right' ? reach : 0);
    const cy = p.y + (p.facing === 'up' ? -reach : p.facing === 'down' ? reach : 0);
    const halfW = p.facing === 'up' || p.facing === 'down' ? 20 : reach + 6;
    const halfH = p.facing === 'left' || p.facing === 'right' ? 20 : reach + 6;

    for (const e of this.enemies) {
      if (e.dead) continue;
      if (Math.abs(e.x - cx) > halfW + ENEMY_BASE[e.kind].r) continue;
      if (Math.abs(e.y - cy) > halfH + ENEMY_BASE[e.kind].r) continue;

      const crit = Math.random() < 0.1;
      const raw = this.atkTotal() + Math.floor(Math.random() * 5) - ENEMY_BASE[e.kind].def;
      const dmg = Math.max(1, Math.floor(raw * (crit ? 2 : 1)));
      e.hp -= dmg;
      e.hitT = 0.15;
      e.flash = 0.12;

      const ang = Math.atan2(e.y - p.y, e.x - p.x);
      e.x += Math.cos(ang) * 12;
      e.y += Math.sin(ang) * 12;
      this.floats.push({
        x: e.x, y: e.y - 16,
        text: crit ? `${dmg}!` : `${dmg}`,
        life: 0.7,
        color: crit ? '#ffd24a' : '#fff',
      });
      for (let i = 0; i < 5; i++) {
        this.particles.push({
          x: e.x, y: e.y,
          vx: (Math.random() - 0.5) * 120,
          vy: -Math.random() * 80,
          life: 0.4, maxLife: 0.4,
          color: ENEMY_BASE[e.kind].dark,
          size: 2 + Math.random() * 2,
        });
      }

      if (e.hp <= 0) this.killEnemy(e);
    }
  }

  private killEnemy(e: Enemy) {
    e.dead = true;
    e.respawnT = 40 + Math.random() * 20;
    this.kills++;
    const b = ENEMY_BASE[e.kind];

    if (e.kind === 'guard') this.guardDead = true;
    if (e.kind === 'boss') {
      this.bossDead = true;
      this.quest.bossDead = true;
      this.shake = 12;
      this.sfx.roar();
      // 临终剧情 → 结局
      window.setTimeout(() => {
        this.dialog = [
          { name: '诺瓦', look: 'nova', hair: '#f0eef8', dress: '#2a1a3a', lines: ['……要消失了，身体的深处，暖洋洋的。', '奇怪。明明是坠落了十年的身体……', '现在的我，是被谁抱着的吗？'] },
          { name: '铃兰', title: '阿尔德拉守护巫女', look: 'miko', hair: '#e8e4f4', dress: '#e05a6a', lines: ['姐姐——！', '（神社的钟声隔着裂缝传来。一个银发的小小身影，', '不顾一切地扑进那片正在消散的白光里。）', '「欢迎回家。」——只来得及说出这一句。'] },
          { name: '', lines: ['白色的羽毛漫天飞舞，深渊的裂隙缓缓闭合。', '十年前的少女，终于在妹妹的怀里，变回了少女。', '——而你，转身走向洒满晨光的归途。'] },
        ];
        this.dialogIdx = 0;
        this.state = 'dialog';
        this.onDialogEnd = () => this.finishGame();
      }, 1200);
    }
    if (e.kind === 'slime') this.quest.slimeKills++;

    // 掉落
    const gold = Math.floor(b.gold[0] + Math.random() * (b.gold[1] - b.gold[0]));
    const coins = Math.min(5, Math.max(1, Math.round(gold / 8)));
    for (let i = 0; i < coins; i++) {
      this.drops.push({
        kind: 'gold',
        x: e.x + (Math.random() - 0.5) * 20,
        y: e.y + (Math.random() - 0.5) * 20,
        value: Math.ceil(gold / coins),
        vx: (Math.random() - 0.5) * 90,
        vy: -Math.random() * 60,
        t: 0,
      });
    }
    if (Math.random() < 0.25) {
      this.drops.push({ kind: 'heart', x: e.x, y: e.y, value: 15, vx: 0, vy: 0, t: 0 });
    }
    if (Math.random() < 0.08) {
      this.drops.push({ kind: 'potion', x: e.x, y: e.y, value: 1, vx: 0, vy: 0, t: 0 });
    }
    if (e.kind === 'guard') {
      this.quest.hasKey = true;
      this.floats.push({ x: e.x, y: e.y - 30, text: '获得「深渊钥匙」', life: 2.5, color: '#c9a0ff' });
      this.sfx.level();
      this.save();
    }

    // 经验
    this.gainXp(b.xp);

    for (let i = 0; i < 12; i++) {
      this.particles.push({
        x: e.x, y: e.y,
        vx: (Math.random() - 0.5) * 180,
        vy: -Math.random() * 140,
        life: 0.6, maxLife: 0.6,
        color: b.color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  private gainXp(xp: number) {
    const p = this.player;
    p.xp += xp;
    while (p.xp >= this.newXpNeed()) {
      p.xp -= this.newXpNeed();
      p.lvl++;
      p.maxHp += 15;
      p.atkBase += 2;
      p.defBase += 1;
      p.hp = p.maxHp;
      this.sfx.level();
      this.floats.push({ x: p.x, y: p.y - 28, text: `升级！Lv.${p.lvl}`, life: 2, color: '#7ec8ff' });
    }
  }

  private damagePlayer(raw: number) {
    const p = this.player;
    if (p.iframes > 0) return;
    const dmg = Math.max(1, Math.floor(raw - this.defTotal() * 0.6));
    p.hp -= dmg;
    p.iframes = 0.8;
    this.shake = Math.max(this.shake, 5);
    this.sfx.hurt();
    this.floats.push({ x: p.x, y: p.y - 20, text: `-${dmg}`, life: 0.8, color: '#ff6a6a' });
    if (p.hp <= 0) {
      p.hp = 0;
      this.state = 'dead';
      this.deadT = 0;
      this.sfx.die();
    }
  }

  private drinkPotion() {
    const p = this.player;
    if (p.potions <= 0 || p.hp >= p.maxHp) return;
    p.potions--;
    p.hp = Math.min(p.maxHp, p.hp + POTION_HEAL);
    this.sfx.potion();
    this.floats.push({ x: p.x, y: p.y - 20, text: `+${POTION_HEAL}`, life: 1, color: '#8fd4a0' });
  }

  private nearNpc(): (typeof this.zone.npcs)[number] | null {
    const p = this.player;
    for (const n of this.zone.npcs) {
      const nx = n.tx * TILE + TILE / 2;
      const ny = n.ty * TILE + TILE / 2;
      if (Math.hypot(nx - p.x, ny - p.y) < 40) return n;
    }
    return null;
  }

  private nearChest(): ChestDef | null {
    const p = this.player;
    for (const c of this.zone.chests) {
      if (this.opened.has(c.id)) continue;
      const cx = c.tx * TILE + TILE / 2;
      const cy = c.ty * TILE + TILE / 2;
      if (Math.hypot(cx - p.x, cy - p.y) < 36) return c;
    }
    return null;
  }

  private tryInteract() {
    const npc = this.nearNpc();
    if (npc) {
      switch (npc.role) {
        case 'elder': this.talkSuzuran(); return;
        case 'merchant': this.openShop(); return;
        case 'guide': this.talkYukki(); return;
        case 'hunter': this.talkTsukimi(); return;
      }
      return;
    }
    const chest = this.nearChest();
    if (chest) {
      this.opened.add(chest.id);
      this.sfx.coin();
      if (chest.gold) {
        this.player.gold += chest.gold;
        this.dialog = [{ name: '宝箱', lines: [`获得了 ${chest.gold} 金币！`] }];
      }
      if (chest.potion) {
        this.player.potions += chest.potion;
        this.dialog = [{ name: '宝箱', lines: [`获得了 ${chest.potion} 瓶治疗药水！`] }];
      }
      if (chest.weapon !== undefined) {
        this.player.weapon = Math.max(this.player.weapon, chest.weapon);
        this.dialog = [{ name: '宝箱', lines: [`获得了「${WEAPONS[chest.weapon].name}」！自动装备了更好的武器。`] }];
      }
      if (chest.armor !== undefined) {
        this.player.armor = Math.max(this.player.armor, chest.armor);
        this.dialog = [{ name: '宝箱', lines: [`获得了「${ARMORS[chest.armor].name}」！自动装备了更好的护甲。`] }];
      }
      this.dialogIdx = 0;
      this.state = 'dialog';
      this.save();
    }
  }

  /* ------------------------- 铃兰（主线） ------------------------- */

  private talkSuzuran() {
    const q = this.quest;
    const base = {
      name: '铃兰',
      title: '阿尔德拉守护巫女',
      look: 'miko' as NpcLook,
      hair: '#e8e4f4',
      dress: '#e05a6a',
    };

    if (q.stage === 0) {
      this.dialog = [
        { ...base, lines: ['……你醒啦？你是三天前倒在神社前的旅行者。', '我叫铃兰，是这座村子——阿尔德拉的守护巫女。', '抱歉在你昏迷时说了这么多奇怪的话。'] },
        { ...base, lines: ['事情是这样的：森林尽头出现了「深渊的裂隙」，', '妖物从裂缝里涌出来，平原上的史莱姆也躁动了起来。', '村子里的年轻人都在筑墙，能战斗的……只有你了。'] },
        { ...base, lines: ['先去东边的绿野平原，清理 8 只史莱姆好吗？', '我知道这个请求很突然——但请你帮帮阿尔德拉。'] },
      ];
      this.onDialogEnd = () => {
        this.quest.stage = 1;
        this.save();
      };
    } else if (q.stage === 1) {
      if (this.quest.slimeKills >= SLIME_TARGET) {
        this.dialog = [
          { ...base, lines: ['回来了！刚才村民说平原上的骚动平息了——', `是你做的对吧？史莱姆讨伐 ${this.quest.slimeKills} 只，一只不少。`, '这 60 金币和两瓶药水是村子的谢礼，收下吧。'] },
          { ...base, lines: ['……接下来是真正的事。', '裂隙的最深处，有「什么东西」在看着这边。', '守护裂隙之门的，是一名被称为「深渊守卫」的存在。'] },
          { ...base, lines: ['它身上挂着打开地牢的「深渊钥匙」。', '——对不起，明明是我拜托你的，却要让你涉险。', '但如果是你的话……一定没问题的。'] },
        ];
        this.onDialogEnd = () => {
          this.quest.stage = 2;
          this.player.gold += 60;
          this.player.potions += 2;
          this.save();
        };
      } else {
        this.dialog = [
          { ...base, lines: [`史莱姆还没清完呢。目前 ${this.quest.slimeKills}/${SLIME_TARGET} 只。`, '它们就在村东的绿野平原上，小心灰狼，它们跑得很快。'] },
        ];
        this.onDialogEnd = null;
      }
    } else if (q.stage === 2) {
      if (this.quest.hasKey) {
        this.dialog = [
          { ...base, lines: ['那把钥匙的光芒……果然。', '森林右下角的裂隙之门，已经可以打开了。', '谢谢你还活着回来……刚才，我差点哭了。'] },
          { ...base, lines: ['有件事，本来不想说的。', '十年前，也有一个人拿着同样的钥匙走进地牢。', '她是我姐姐——前代魔法少女，「白夜」。', '然后……她再也没有回来。'] },
          { ...base, lines: ['地牢深处那股气息，有时候……真的很像姐姐。', '如果是她的话，拜托你，带她回家。', '……如果是别的东西，也拜托你，终结这一切。'] },
        ];
        this.onDialogEnd = () => {
          this.quest.stage = 3;
          this.save();
        };
      } else {
        this.dialog = [
          { ...base, lines: ['深渊钥匙还在守卫身上。', '森林里的猎人「月见」似乎在盯着那家伙，', '去找她打听一下情报吧，应该能轻松一点。'] },
        ];
        this.onDialogEnd = null;
      }
    } else if (q.stage === 3) {
      this.dialog = [
        { ...base, lines: ['钥匙交给你了。裂隙之门就在森林的右下角。', '备好药水……还有，活着回来。', '我会在神社前等你——无论多少个夜晚。'] },
      ];
      this.onDialogEnd = null;
    } else {
      this.dialog = [
        { ...base, lines: ['裂隙闭合的那天早上，神社前的樱花全开了。', '姐姐她……最后是笑着化成光的。', '谢谢你。阿尔德拉，不，「这个世界」都会记得你的名字。'] },
      ];
      this.onDialogEnd = null;
    }
    this.dialogIdx = 0;
    this.state = 'dialog';
  }

  /* ------------------------- 雪球 / 月见（支线） ------------------------- */

  private talkYukki() {
    const base = {
      name: '雪球',
      title: '桥边的猫娘',
      look: 'cat' as NpcLook,
      hair: '#f4f0ea',
      dress: '#f0b0c0',
    };
    if (!this.metGuide) {
      this.metGuide = true;
      this.player.gold += 20;
      this.dialog = [
        { ...base, lines: ['喵？是人类的崽崽……好少见。', '本喵叫雪球，负责在这座桥上……晒太阳。嗯，负责晒太阳。'] },
        { ...base, lines: ['看你一副要去冒险的样子，这个给你——', '（雪球不知从哪里掏出一小把金币，塞到你手里。）', '桥底下那片水塘里有鱼，也有……会咬人的东西。小心喵。'] },
        { ...base, lines: ['南边的草丛里藏着一个宝箱哦，本喵才不会告诉你', '就在花最多的那块地方附近……喵呜，说漏了。'] },
      ];
      this.onDialogEnd = () => this.save();
    } else {
      this.dialog = [
        { ...base, lines: ['喵嗷——又是你。今天也要加油喵。', '本喵就在这里晒太阳，等你的好消息喵。'] },
      ];
      this.onDialogEnd = null;
    }
    this.dialogIdx = 0;
    this.state = 'dialog';
  }

  private talkTsukimi() {
    const base = {
      name: '月见',
      title: '森林的兽耳猎人',
      look: 'hood' as NpcLook,
      hair: '#5a4a7a',
      dress: '#3a5a40',
    };
    if (!this.metHunter) {
      this.metHunter = true;
      this.player.potions += 2;
      this.dialog = [
        { ...base, lines: ['……站住。', '（箭尖停在你喉咙前三寸的地方，然后缓缓放下了。）', '……人类？能从那些骷髅手里活着走到这，算你有点本事。'] },
        { ...base, lines: ['我叫月见。在这片森林里，盯着深渊的动向。', '你要找的「深渊守卫」在森林中央的空地。', '它挥爪前会先压低身体——看到那个动作就翻滚躲开。'] },
        { ...base, lines: ['这两瓶药水你拿着。不是送给你的，是投资。', '你死在半路的话，我的情报就白费了。', '……快走吧。森林入夜后，会更危险。'] },
      ];
      this.onDialogEnd = () => this.save();
    } else if (this.quest.hasKey) {
      this.dialog = [
        { ...base, lines: ['拿到钥匙了？……比我想的要快。', '门后的东西，和守卫不是一个级别的。', '——记住，无论看到什么，都别停下脚步。'] },
      ];
      this.onDialogEnd = null;
    } else {
      this.dialog = [
        { ...base, lines: ['守卫在中央空地。压低身体=攻击前兆。', '……别死在外面，会很麻烦。'] },
      ];
      this.onDialogEnd = null;
    }
    this.dialogIdx = 0;
    this.state = 'dialog';
  }

  /* ------------------------- 商店 ------------------------- */

  private shopItems(): Array<{ label: string; price: number; canBuy: boolean; note: string; apply: () => void }> {
    const p = this.player;
    const items: Array<{ label: string; price: number; canBuy: boolean; note: string; apply: () => void }> = [
      {
        label: '治疗药水',
        price: POTION_PRICE,
        canBuy: p.gold >= POTION_PRICE,
        note: `恢复 ${POTION_HEAL} HP`,
        apply: () => { p.potions++; },
      },
    ];
    for (let i = 1; i < WEAPONS.length; i++) {
      const w = WEAPONS[i];
      items.push({
        label: w.name,
        price: w.price,
        canBuy: p.gold >= w.price && p.weapon < i,
        note: p.weapon >= i ? '已拥有' : `攻击 +${w.atk}`,
        apply: () => { p.weapon = i; },
      });
    }
    for (let i = 1; i < ARMORS.length; i++) {
      const a = ARMORS[i];
      items.push({
        label: a.name,
        price: a.price,
        canBuy: p.gold >= a.price && p.armor < i,
        note: p.armor >= i ? '已拥有' : `防御 +${a.def}`,
        apply: () => { p.armor = i; },
      });
    }
    return items;
  }

  private openShop() {
    this.shopIdx = 0;
    const flavors = [
      '「哼，要买就快点，本店很忙的！」',
      '「才、才不是特意等你回来呢……」',
      '「这可是好东西，别处买不到的哦。」',
      '「上次赊的账我可还记着呢。」',
      '「路上小心……不是关心你啦，是货款没结清。」',
    ];
    this.shopFlavor = flavors[Math.floor(Math.random() * flavors.length)];
    this.state = 'shop';
  }

  private buyItem(item: { label: string; price: number; canBuy: boolean; apply: () => void }) {
    if (!item.canBuy) {
      this.sfx.hurt();
      return;
    }
    this.player.gold -= item.price;
    item.apply();
    this.sfx.coin();
    this.save();
  }

  /* ------------------------- 传送 / 结局 ------------------------- */

  private checkPortals() {
    if (this.pendingZone || this.fade > 0) return;
    const p = this.player;
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    for (const portal of this.zone.portals) {
      if (portal.tx !== tx || portal.ty !== ty) continue;
      if (portal.requires === 'abyss-key' && !this.quest.hasKey) {
        if (!this.just('e')) continue;
        this.dialog = [{ name: '裂隙之门', lines: ['门上刻着深渊的符文，需要「深渊钥匙」才能打开。'] }];
        this.dialogIdx = 0;
        this.state = 'dialog';
        return;
      }
      this.pendingZone = { to: portal.to, px: portal.px, py: portal.py };
      this.fadeDir = 1;
      return;
    }
  }

  private finishGame() {
    this.state = 'ending';
    this.endStats = `等级 ${this.player.lvl} · 击杀 ${this.kills} · 金币 ${this.player.gold}`;
    this.save();
  }

  private updateEnemy(e: Enemy, dt: number) {
    const p = this.player;
    const b = ENEMY_BASE[e.kind];
    const dist = Math.hypot(p.x - e.x, p.y - e.y);

    if (e.kind === 'boss') {
      // 首次接近：触发剧情对话，战斗暂时冻结
      if (!this.bossIntroDone && dist < 230) {
        this.bossIntroDone = true;
        this.sfx.roar();
        this.state = 'dialog';
        this.dialogIdx = 0;
        this.dialog = [
          { name: '？？？', lines: ['——又是人类的气味。', '（裂缝深处，白色的身影缓缓转身。破碎的裙摆，', '和一双早已失去颜色的眼睛。）'] },
          { name: '深渊魔女·诺瓦', title: '前代魔法少女·白夜', look: 'nova', hair: '#f0eef8', dress: '#2a1a3a', lines: ['我叫诺瓦。不过……这个名字，已经没有人记得了吧。', '那孩子……铃兰，都长这么大了呀。还在守着那个小村子吗。', '真幸福啊。可惜——深渊不会允许任何人回头。'] },
        ];
        return;
      }
      this.updateBoss(e, b, dist, dt);
    } else if (dist < b.aggro) {
      // 追击
      const ang = Math.atan2(p.y - e.y, p.x - e.x);
      const wob = Math.sin(this.time * 3 + e.spawnKey.length) * 0.35;
      const vx = Math.cos(ang + wob) * b.spd;
      const vy = Math.sin(ang + wob) * b.spd;
      this.moveEntity(e, vx * dt, vy * dt, b.r);
      e.vx = vx;
      e.vy = vy;
    } else {
      // 游荡
      if (e.aiT <= 0) {
        e.aiT = 1.5 + Math.random() * 2;
        e.vx = (Math.random() - 0.5) * b.spd * 0.6;
        e.vy = (Math.random() - 0.5) * b.spd * 0.6;
      }
      this.moveEntity(e, e.vx * dt, e.vy * dt, b.r);
    }

    // 接触伤害
    if (dist < b.r + 12 && e.atkCd <= 0) {
      e.atkCd = 0.8;
      this.damagePlayer(b.atk);
    }
  }

  private updateBoss(e: Enemy, b: (typeof ENEMY_BASE)['boss'], dist: number, dt: number) {
    const p = this.player;
    e.aiT -= dt;

    if (dist > 60) {
      const ang = Math.atan2(p.y - e.y, p.x - e.x);
      this.moveEntity(e, Math.cos(ang) * b.spd * dt, Math.sin(ang) * b.spd * dt, b.r);
    }

    // 半血召唤一次
    if (!e.summoned && e.hp < e.maxHp * 0.5) {
      e.summoned = true;
      this.sfx.roar();
      this.shake = 8;
      for (const [ox, oy] of [[-60, 0], [60, 0]]) {
        const k: Enemy = {
          kind: 'knight',
          x: e.x + ox,
          y: e.y + oy,
          hp: ENEMY_BASE.knight.hp,
          maxHp: ENEMY_BASE.knight.hp,
          spawnKey: 'boss-summon',
          permanent: true,
          dead: false,
          respawnT: 0,
          hitT: 0,
          atkCd: 1,
          aiT: 0,
          vx: 0,
          vy: 0,
          flash: 0,
          summoned: true,
        };
        this.enemies.push(k);
      }
      this.floats.push({ x: e.x, y: e.y - 40, text: '「来吧，骑士们……陪客人跳支舞。」', life: 2.2, color: '#ff9a9a' });
    }

    // 周期性弹幕
    if (e.aiT <= 0) {
      e.aiT = 3.2;
      this.sfx.roar();
      const roll = Math.random();
      if (roll < 0.5) {
        // 环形 10 发
        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * Math.PI * 2 + this.time;
          this.projectiles.push({
            x: e.x, y: e.y,
            vx: Math.cos(ang) * 110,
            vy: Math.sin(ang) * 110,
            life: 4,
            dmg: b.atk - 6,
          });
        }
      } else {
        // 瞄准三连
        const ang = Math.atan2(p.y - e.y, p.x - e.x);
        for (const off of [-0.25, 0, 0.25]) {
          this.projectiles.push({
            x: e.x, y: e.y,
            vx: Math.cos(ang + off) * 150,
            vy: Math.sin(ang + off) * 150,
            life: 3.5,
            dmg: b.atk - 4,
          });
        }
      }
    }
  }

  /* ============================================================
   * 渲染
   * ============================================================ */

  private draw() {
    const c = this.ctx;
    c.fillStyle = '#0a0c10';
    c.fillRect(0, 0, VIEW_W, VIEW_H);
    c.textBaseline = 'middle';

    if (this.state === 'title') { this.drawTitle(); return; }

    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;

    c.save();
    c.translate(-Math.round(this.camX) + sx, -Math.round(this.camY) + sy);

    this.drawTiles();

    // 掉落物
    for (const d of this.drops) {
      const bob = Math.sin(this.time * 5 + d.x) * 2;
      if (d.kind === 'gold') {
        c.fillStyle = '#f0c94a';
        c.fillRect(d.x - 3, d.y - 3 + bob, 6, 6);
        c.fillStyle = '#fff2b0';
        c.fillRect(d.x - 3, d.y - 3 + bob, 3, 3);
      } else if (d.kind === 'heart') {
        c.fillStyle = '#ff5a6a';
        c.fillRect(d.x - 3, d.y - 3 + bob, 3, 3);
        c.fillRect(d.x + 1, d.y - 3 + bob, 3, 3);
        c.fillRect(d.x - 2, d.y + bob, 5, 3);
        c.fillRect(d.x - 1, d.y + 3 + bob, 3, 2);
      } else {
        c.fillStyle = '#e05a6a';
        c.fillRect(d.x - 3, d.y - 5 + bob, 7, 9);
        c.fillStyle = '#fff';
        c.fillRect(d.x - 1, d.y - 7 + bob, 3, 3);
      }
    }

    // 宝箱
    for (const ch of this.zone.chests) {
      const x = ch.tx * TILE + 4;
      const y = ch.ty * TILE + 6;
      const open = this.opened.has(ch.id);
      c.fillStyle = open ? '#5a4a30' : '#8a6a38';
      c.fillRect(x, y + 4, 16, 10);
      c.fillStyle = open ? '#4a3c26' : '#a5822f';
      c.fillRect(x, y, 16, 6);
      c.fillStyle = '#f0d060';
      c.fillRect(x + 7, y + 7, 2, 4);
    }

    // NPC
    for (const n of this.zone.npcs) {
      const x = n.tx * TILE + TILE / 2;
      const y = n.ty * TILE + TILE / 2;
      this.drawNpcSprite(x, y, n);
      // 头顶名字
      c.font = '10px "Microsoft YaHei", sans-serif';
      c.textAlign = 'center';
      c.fillStyle = 'rgba(0,0,0,0.45)';
      const w = c.measureText(n.name).width + 8;
      c.fillRect(x - w / 2, y - 26, w, 12);
      c.fillStyle = '#ffe9a0';
      c.fillText(n.name, x, y - 19.5);
      c.textAlign = 'left';
      // 可交互提示
      if (this.nearNpc()?.name === n.name) {
        c.fillStyle = '#fff';
        c.font = 'bold 11px "Microsoft YaHei", sans-serif';
        c.fillText('E', x - 3, y - 34);
      }
    }

    // 敌人（按 y 排序和玩家一起画）
    const drawables: Array<{ y: number; fn: () => void }> = [];
    for (const e of this.enemies) {
      if (e.dead) continue;
      drawables.push({ y: e.y, fn: () => this.drawEnemy(e) });
    }
    drawables.push({ y: this.player.y, fn: () => this.drawPlayer() });
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.fn();

    // 弹幕
    for (const b of this.projectiles) {
      c.fillStyle = '#ff7a9a';
      c.beginPath();
      c.arc(b.x, b.y, 4, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#ffd0da';
      c.beginPath();
      c.arc(b.x - 1, b.y - 1, 1.6, 0, Math.PI * 2);
      c.fill();
    }

    // 粒子
    for (const p of this.particles) {
      c.globalAlpha = Math.max(0, p.life / p.maxLife);
      c.fillStyle = p.color;
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    c.globalAlpha = 1;

    // 飘字
    c.font = 'bold 11px "Microsoft YaHei", sans-serif';
    c.textAlign = 'center';
    for (const f of this.floats) {
      c.globalAlpha = Math.min(1, f.life * 2);
      c.fillStyle = '#000';
      c.fillText(f.text, f.x + 1, f.y + 1);
      c.fillStyle = f.color;
      c.fillText(f.text, f.x, f.y);
    }
    c.globalAlpha = 1;
    c.textAlign = 'left';

    // 区域环境色
    if (this.zone.id === 'forest') {
      c.fillStyle = 'rgba(20, 30, 15, 0.18)';
      c.fillRect(this.camX, this.camY, VIEW_W, VIEW_H);
    } else if (this.zone.id === 'dungeon') {
      c.fillStyle = 'rgba(10, 5, 20, 0.3)';
      c.fillRect(this.camX, this.camY, VIEW_W, VIEW_H);
    }

    c.restore();

    // 画面暗角（地牢更重，营造压迫感）
    const vg = c.createRadialGradient(
      VIEW_W / 2,
      VIEW_H / 2,
      VIEW_H * 0.34,
      VIEW_W / 2,
      VIEW_H / 2,
      VIEW_H * 0.82,
    );
    const vgA = this.zone.id === 'dungeon' ? 0.62 : 0.34;
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(0,0,0,${vgA})`);
    c.fillStyle = vg;
    c.fillRect(0, 0, VIEW_W, VIEW_H);

    this.drawHud();

    if (this.state === 'dialog') this.drawDialog();
    else if (this.state === 'shop') this.drawShop();
    else if (this.state === 'paused') this.drawPause();
    else if (this.state === 'dead') this.drawDead();
    else if (this.state === 'ending') this.drawEnding();

    if (this.zoneLabelT > 0) {
      const a = Math.min(1, this.zoneLabelT);
      c.globalAlpha = a;
      c.font = 'bold 18px "Microsoft YaHei", sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#000';
      c.fillText(this.zone.name, VIEW_W / 2 + 1, 41);
      c.fillStyle = '#ffe9a0';
      c.fillText(this.zone.name, VIEW_W / 2, 40);
      c.globalAlpha = 1;
      c.textAlign = 'left';
    }

    // 渐变转场
    if (this.fade > 0) {
      c.fillStyle = `rgba(0,0,0,${Math.min(1, this.fade)})`;
      c.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  /* ------------------------- 地块 ------------------------- */

  private drawTiles() {
    const c = this.ctx;
    const x0 = Math.max(0, Math.floor(this.camX / TILE));
    const y0 = Math.max(0, Math.floor(this.camY / TILE));
    const x1 = Math.min(MAP_W - 1, Math.ceil((this.camX + VIEW_W) / TILE));
    const y1 = Math.min(MAP_H - 1, Math.ceil((this.camY + VIEW_H) / TILE));
    const artCtx = { time: this.time, dungeon: this.zone.id === 'dungeon' };

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = this.zone.tiles[ty]?.[tx] ?? '#';
        drawTile(c, t, tx * TILE, ty * TILE, tx, ty, artCtx);
      }
    }
  }

  /* ------------------------- 角色 ------------------------- */

  /** NPC 立绘（按 look 画不同发型 / 兽耳 / 兜帽） */
  private drawNpcSprite(x: number, y: number, n: { look: NpcLook; hair: string; dress: string }) {
    drawNpcArt(this.ctx, x, y, { look: n.look, hair: n.hair, dress: n.dress, time: this.time });
  }

  private drawPlayer() {
    const c = this.ctx;
    const p = this.player;
    const x = Math.round(p.x);
    const y = Math.round(p.y);

    drawHero(c, x, y, {
      facing: p.facing,
      moving: p.moving,
      anim: p.anim,
      swing: p.swing,
      iframes: p.iframes,
      weapon: p.weapon,
      time: this.time,
    });
  }

  private drawEnemy(e: Enemy) {
    const c = this.ctx;
    const b = ENEMY_BASE[e.kind];
    const x = Math.round(e.x);
    const y = Math.round(e.y);
    const flash = e.flash > 0;

    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    c.ellipse(x, y + b.r * 0.8, b.r, b.r * 0.4, 0, 0, Math.PI * 2);
    c.fill();

    const body = flash ? '#ffffff' : b.color;
    const dark = flash ? '#dddddd' : b.dark;
    const bob = Math.sin(this.time * 4 + e.x * 0.1) * 1.5;
    void bob;

    drawEnemyArt(c, e.kind, x, y, {
      r: b.r,
      color: body,
      dark,
      flash,
      time: this.time,
      vx: e.vx,
      hpFrac: e.hp / e.maxHp,
      phase: e.spawnKey.length * 0.7,
    });

    // 血条
    if (e.hp < e.maxHp) {
      const w = e.kind === 'boss' ? 40 : 22;
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.fillRect(x - w / 2, y - b.r - 10, w, 4);
      c.fillStyle = e.kind === 'boss' ? '#ff4a6a' : '#7ec84a';
      c.fillRect(x - w / 2, y - b.r - 10, (w * Math.max(0, e.hp)) / e.maxHp, 4);
    }
  }

  /* ------------------------- HUD ------------------------- */

  private drawHud() {
    const c = this.ctx;
    const p = this.player;

    /* ---- 左上：等级 + 生命条 + 经验条 ---- */
    this.panel(10, 10, 152, 34);
    // 等级徽章
    rect2(c, 16, 16, 20, 18, '#1d2434');
    c.font = 'bold 10px "Microsoft YaHei", sans-serif';
    c.textAlign = 'center';
    c.fillStyle = PAL.hero.light;
    c.fillText(`Lv${p.lvl}`, 26, 25.5);
    c.textAlign = 'left';

    // 生命条（带分段刻度）
    const bx = 40;
    rect2(c, bx, 16, 116, 11, '#3a1418');
    const hpw = (116 * Math.max(0, p.hp)) / p.maxHp;
    rect2(c, bx, 16, hpw, 11, '#e04a5a');
    rect2(c, bx, 16, hpw, 4, '#ff8a94'); // 上沿高光
    for (let i = 1; i < 4; i++) rect2(c, bx + (116 * i) / 4, 16, 1, 11, 'rgba(0,0,0,0.35)');
    c.font = '9px "Microsoft YaHei", sans-serif';
    c.fillStyle = '#fff';
    c.fillText(`${Math.ceil(p.hp)}/${p.maxHp}`, bx + 4, 25);

    // 经验条
    rect2(c, bx, 30, 116, 6, '#2a2a14');
    rect2(c, bx, 30, (116 * p.xp) / this.newXpNeed(), 6, '#e0c84a');
    rect2(c, bx, 30, (116 * p.xp) / this.newXpNeed(), 2, '#ffe98a');

    /* ---- 左上下方：金币 / 药水 / 装备 ---- */
    this.panel(10, 48, 152, 44);
    drawCoin(c, 18, 55);
    c.font = '11px "Microsoft YaHei", sans-serif';
    c.fillStyle = '#ffe9a0';
    c.fillText(`${p.gold}`, 30, 62);
    drawPotion(c, 80, 54);
    c.fillStyle = p.potions > 0 ? '#d8dce4' : '#5a6270';
    c.fillText(`${p.potions} (K)`, 92, 62);
    c.font = '10px "Microsoft YaHei", sans-serif';
    c.fillStyle = '#9ab0c8';
    c.fillText(`${WEAPONS[p.weapon].name} · ${ARMORS[p.armor].name}`, 18, 82);

    /* ---- 右上：任务（留足右边距，避免文字出屏）---- */
    const qt = questTitle(this.quest);
    c.font = '11px "Microsoft YaHei", sans-serif';
    const labelW = c.measureText('任务').width;
    const textW = c.measureText(qt).width;
    const qw = labelW + textW + 30;
    const qx = VIEW_W - qw - 12;
    this.panel(qx, 10, qw, 24);
    c.fillStyle = '#ffe9a0';
    c.fillText('任务', qx + 10, 23);
    c.fillStyle = '#d8dce4';
    c.fillText(qt, qx + 10 + labelW + 10, 23);

    /* ---- 底部：交互提示 ---- */
    const hint = this.nearNpc() ? 'E 对话' : this.nearChest() ? 'E 打开宝箱' : '';
    if (hint) {
      c.font = '11px "Microsoft YaHei", sans-serif';
      const hw = c.measureText(hint).width + 22;
      this.panel(VIEW_W / 2 - hw / 2, VIEW_H - 38, hw, 22);
      c.fillStyle = '#fff';
      c.textAlign = 'center';
      c.fillText(hint, VIEW_W / 2, VIEW_H - 25);
      c.textAlign = 'left';
    }
  }

  /* ------------------------- 面板 ------------------------- */

  /** 带描边的圆角面板 */
  private panel(x: number, y: number, w: number, h: number) {
    const c = this.ctx;
    c.fillStyle = 'rgba(10, 13, 20, 0.86)';
    c.fillRect(x, y, w, h);
    c.fillStyle = 'rgba(255,255,255,0.06)';
    c.fillRect(x, y, w, 1);
    c.strokeStyle = 'rgba(120, 160, 220, 0.4)';
    c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  private drawDialog() {
    const c = this.ctx;
    const page = this.dialog[this.dialogIdx];
    if (!page) return;
    const x = 40;
    const w = VIEW_W - 80;
    const h = 96;
    const y = VIEW_H - h - 14;
    this.panel(x, y, w, h);

    const full = this.dialog.length > 1 ? `${this.dialogIdx + 1}/${this.dialog.length}` : '';

    // 头像框
    if (page.look) {
      const px = x + 14;
      const py = y + 16;
      c.fillStyle = 'rgba(255,255,255,0.06)';
      c.fillRect(px, py, 56, 64);
      c.strokeStyle = 'rgba(120,160,220,0.4)';
      c.strokeRect(px + 0.5, py + 0.5, 56, 64);
      // 放大版立绘（3x）
      c.save();
      c.translate(px + 28, py + 46);
      c.scale(2.4, 2.4);
      this.drawNpcSprite(0, 0, {
        look: page.look,
        hair: page.hair ?? '#cccccc',
        dress: page.dress ?? '#888888',
      });
      c.restore();
    }

    const textX = page.look ? x + 84 : x + 16;
    c.font = 'bold 12px "Microsoft YaHei", sans-serif';
    c.fillStyle = '#ffe9a0';
    c.fillText(page.name, textX, y + 24);
    if (page.title) {
      c.font = '10px "Microsoft YaHei", sans-serif';
      c.fillStyle = '#8fb4d8';
      c.fillText(`「${page.title}」`, textX + c.measureText(page.name).width + 8, y + 24);
    }
    c.font = '11px "Microsoft YaHei", sans-serif';
    c.fillStyle = '#d8dce4';
    let ly = y + 44;
    for (const line of page.lines) {
      for (const seg of wrapText(c, line, w - (textX - x) - 30)) {
        c.fillText(seg, textX, ly);
        ly += 16;
      }
    }
    c.fillStyle = '#7d8496';
    c.textAlign = 'right';
    c.fillText(`${full ? full + ' · ' : ''}E 继续`, x + w - 14, y + h - 12);
    c.textAlign = 'left';
  }

  private drawShop() {
    const c = this.ctx;
    const items = this.shopItems();
    const w = 340;
    const h = 60 + items.length * 24 + 30;
    const x = (VIEW_W - w) / 2;
    const y = (VIEW_H - h) / 2;
    this.panel(x, y, w, h);

    c.font = 'bold 13px "Microsoft YaHei", sans-serif';
    c.fillStyle = '#ffe9a0';
    c.fillText('玛戈的杂货铺', x + 16, y + 20);
    c.font = '10.5px "Microsoft YaHei", sans-serif';
    c.fillStyle = '#c88a9a';
    c.fillText(this.shopFlavor, x + 16, y + 36);
    c.font = '11px "Microsoft YaHei", sans-serif';
    c.fillStyle = '#f0c94a';
    c.textAlign = 'right';
    c.fillText(`金币 ${this.player.gold}`, x + w - 16, y + 20);
    c.textAlign = 'left';

    items.forEach((it, i) => {
      const iy = y + 56 + i * 24;
      if (i === this.shopIdx) {
        c.fillStyle = 'rgba(23, 147, 209, 0.22)';
        c.fillRect(x + 8, iy - 9, w - 16, 20);
        c.fillStyle = '#7ec8ff';
        c.fillText('▶', x + 14, iy + 1);
      }
      c.fillStyle = it.canBuy ? '#e8ecf4' : '#6a707c';
      c.fillText(it.label, x + 30, iy + 1);
      c.fillStyle = '#7d8496';
      c.fillText(it.note, x + 130, iy + 1);
      c.textAlign = 'right';
      c.fillStyle = it.canBuy ? '#f0c94a' : '#6a707c';
      c.fillText(it.price === 0 ? '—' : `${it.price} G`, x + w - 16, iy + 1);
      c.textAlign = 'left';
    });

    c.fillStyle = '#7d8496';
    c.fillText('W/S 选择 · J 购买 · Esc 关闭', x + 16, y + h - 14);
  }

  private drawPause() {
    const c = this.ctx;
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(0, 0, VIEW_W, VIEW_H);
    const w = 240;
    const h = 180;
    const x = (VIEW_W - w) / 2;
    const y = (VIEW_H - h) / 2;
    this.panel(x, y, w, h);
    c.font = 'bold 14px "Microsoft YaHei", sans-serif';
    c.fillStyle = '#ffe9a0';
    c.textAlign = 'center';
    c.fillText('暂 停', VIEW_W / 2, y + 26);
    c.font = '12px "Microsoft YaHei", sans-serif';
    const items = ['继续冒险', '保存进度', this.sfx.on ? '音效：开' : '音效：关', '保存并回主菜单'];
    items.forEach((it, i) => {
      const iy = y + 56 + i * 26;
      if (i === this.pauseIdx) {
        c.fillStyle = 'rgba(23, 147, 209, 0.22)';
        c.fillRect(x + 20, iy - 10, w - 40, 22);
      }
      c.fillStyle = i === this.pauseIdx ? '#7ec8ff' : '#c8ccd8';
      c.fillText(it, VIEW_W / 2, iy + 1);
    });
    c.textAlign = 'left';
  }

  private drawDead() {
    const c = this.ctx;
    c.fillStyle = `rgba(30, 0, 8, ${Math.min(0.85, this.deadT)})`;
    c.fillRect(0, 0, VIEW_W, VIEW_H);
    if (this.deadT > 0.6) {
      c.font = 'bold 30px "Microsoft YaHei", sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#ff5a6a';
      c.fillText('你倒下了……', VIEW_W / 2, VIEW_H / 2 - 20);
      c.font = '12px "Microsoft YaHei", sans-serif';
      c.fillStyle = '#c8ccd8';
      c.fillText('按 Enter 回到村庄（损失 25% 金币）', VIEW_W / 2, VIEW_H / 2 + 20);
      c.textAlign = 'left';
    }
  }

  private drawEnding() {
    const c = this.ctx;
    const g = c.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, '#0a1428');
    g.addColorStop(1, '#1a0a20');
    c.fillStyle = g;
    c.fillRect(0, 0, VIEW_W, VIEW_H);

    c.textAlign = 'center';
    c.font = 'bold 30px "Microsoft YaHei", sans-serif';
    c.fillStyle = '#ffe9a0';
    c.fillText('深渊的回响平息了', VIEW_W / 2, VIEW_H / 2 - 70);
    c.font = '13px "Microsoft YaHei", sans-serif';
    c.fillStyle = '#c8d4e8';
    c.fillText('深渊魔女·诺瓦——不，「白夜」——在妹妹的怀里化作了光。', VIEW_W / 2, VIEW_H / 2 - 28);
    c.fillText('裂隙闭合，晨光重新照进阿尔德拉的樱花树。', VIEW_W / 2, VIEW_H / 2 - 6);
    c.fillText('吟游诗人会把两个人的名字写进同一首歌里。', VIEW_W / 2, VIEW_H / 2 + 16);
    c.fillStyle = '#7ec8ff';
    c.fillText(this.endStats, VIEW_W / 2, VIEW_H / 2 + 48);
    c.fillStyle = '#7d8496';
    c.fillText('Esc / Enter 返回标题（存档已清除）', VIEW_W / 2, VIEW_H / 2 + 84);
    c.textAlign = 'left';
  }

  /* ------------------------- 标题 ------------------------- */

  private drawTitle() {
    const c = this.ctx;
    // 夜空渐变
    const g = c.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, '#080b16');
    g.addColorStop(0.45, '#131a2e');
    g.addColorStop(0.75, '#20182c');
    g.addColorStop(1, '#2a1430');
    c.fillStyle = g;
    c.fillRect(0, 0, VIEW_W, VIEW_H);

    // 星尘（闪烁）
    for (let i = 0; i < 70; i++) {
      const sx = hash(i, 7, 3) * VIEW_W;
      const sy = hash(i, 13, 5) * VIEW_H * 0.7;
      const tw = 0.2 + Math.abs(Math.sin(this.time * 1.4 + i * 0.7)) * 0.55;
      c.globalAlpha = tw;
      c.fillStyle = hash(i, 3, 9) > 0.85 ? '#ffe9c0' : '#c8d8ff';
      const s = hash(i, 5, 11) > 0.9 ? 2 : 1.4;
      c.fillRect(sx, sy, s, s);
    }
    c.globalAlpha = 1;

    // 月亮 + 光晕
    const mx = VIEW_W - 130;
    const my = 92;
    const halo = c.createRadialGradient(mx, my, 6, mx, my, 70);
    halo.addColorStop(0, 'rgba(220, 228, 255, 0.28)');
    halo.addColorStop(1, 'rgba(220, 228, 255, 0)');
    c.fillStyle = halo;
    c.fillRect(mx - 80, my - 80, 160, 160);
    c.fillStyle = '#e8ecff';
    c.beginPath();
    c.arc(mx, my, 20, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(190, 200, 230, 0.5)'; // 环形山
    c.fillRect(mx - 8, my - 6, 6, 5);
    c.fillRect(mx + 3, my + 4, 4, 4);
    c.fillRect(mx - 2, my + 9, 3, 3);

    // 远山剪影（两层）
    c.fillStyle = '#141a2a';
    c.beginPath();
    c.moveTo(0, 300);
    for (let i = 0; i <= 8; i++) {
      const hx = (i / 8) * VIEW_W;
      const hy = 300 - Math.abs(Math.sin(i * 1.7)) * 62;
      c.lineTo(hx, hy);
    }
    c.lineTo(VIEW_W, 300);
    c.lineTo(VIEW_W, VIEW_H);
    c.lineTo(0, VIEW_H);
    c.closePath();
    c.fill();

    // 近景丘陵 + 小村庄剪影
    c.fillStyle = '#0d1220';
    c.beginPath();
    c.moveTo(0, 372);
    for (let i = 0; i <= 6; i++) {
      const hx = (i / 6) * VIEW_W;
      const hy = 372 - Math.abs(Math.cos(i * 1.3)) * 30;
      c.lineTo(hx, hy);
    }
    c.lineTo(VIEW_W, VIEW_H);
    c.lineTo(0, VIEW_H);
    c.closePath();
    c.fill();
    // 村庄：几间小屋 + 神社鸟居
    const hy0 = 396;
    for (let i = 0; i < 5; i++) {
      const vx = 90 + i * 96;
      c.fillStyle = '#0a0e18';
      c.fillRect(vx, hy0, 30, 16);
      c.beginPath();
      c.moveTo(vx - 4, hy0);
      c.lineTo(vx + 15, hy0 - 12);
      c.lineTo(vx + 34, hy0);
      c.closePath();
      c.fill();
      // 窗光
      c.fillStyle = `rgba(255, 200, 110, ${(0.5 + Math.sin(this.time * 1.6 + i) * 0.2).toFixed(2)})`;
      c.fillRect(vx + 7, hy0 + 5, 5, 5);
    }
    // 鸟居
    c.fillStyle = '#5a1e26';
    c.fillRect(422, hy0 - 22, 4, 38);
    c.fillRect(462, hy0 - 22, 4, 38);
    c.fillRect(410, hy0 - 26, 68, 5);
    c.fillRect(414, hy0 - 16, 60, 3);

    // 地平线处的深渊裂隙辉光
    const fissure = c.createLinearGradient(0, 400, 0, VIEW_H);
    fissure.addColorStop(0, `rgba(138, 90, 208, ${(0.16 + Math.sin(this.time * 1.2) * 0.06).toFixed(3)})`);
    fissure.addColorStop(1, 'rgba(138, 90, 208, 0)');
    c.fillStyle = fissure;
    c.fillRect(0, 400, VIEW_W, VIEW_H - 400);

    // 漂浮的紫色微粒（深渊气息）
    for (let i = 0; i < 18; i++) {
      const px = (hash(i, 21, 3) * VIEW_W + this.time * (8 + i)) % VIEW_W;
      const py = 420 - ((this.time * (14 + i * 2) + hash(i, 5, 7) * 300) % 300);
      c.fillStyle = `rgba(190, 150, 255, ${(0.14 + Math.abs(Math.sin(this.time + i)) * 0.2).toFixed(2)})`;
      c.fillRect(px, py, 2, 2);
    }

    c.textAlign = 'center';
    // 主标题：外发光 + 立体投影
    c.font = 'bold 42px "Microsoft YaHei", sans-serif';
    c.fillStyle = 'rgba(90, 50, 160, 0.35)';
    c.fillText('深 渊 回 响', VIEW_W / 2, 118);
    c.fillStyle = '#0a3c58';
    c.fillText('深 渊 回 响', VIEW_W / 2 + 2.5, 122.5);
    c.fillStyle = '#eef2fa';
    c.fillText('深 渊 回 响', VIEW_W / 2, 120);
    c.fillStyle = '#bfe6ff';
    c.font = 'bold 42px "Microsoft YaHei", sans-serif';
    c.fillText('深 渊 回 响', VIEW_W / 2 - 0.8, 119.2);
    // 副标题带装饰线
    c.font = '12px "Microsoft YaHei", sans-serif';
    c.fillStyle = '#8f96a8';
    c.fillText('—— 像素动作 RPG · 单人离线 ——', VIEW_W / 2, 152);
    c.strokeStyle = 'rgba(140, 170, 220, 0.35)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(VIEW_W / 2 - 200, 152);
    c.lineTo(VIEW_W / 2 - 110, 152);
    c.moveTo(VIEW_W / 2 + 110, 152);
    c.lineTo(VIEW_W / 2 + 200, 152);
    c.stroke();

    const items = this.hasSave ? ['开始新游戏', '继续冒险'] : ['开始新游戏'];
    items.forEach((it, i) => {
      const iy = 224 + i * 36;
      const sel = i === this.titleIdx;
      const bw = 168;
      if (sel) {
        // 选中框：底 + 描边 + 左右箭头
        c.fillStyle = 'rgba(23, 147, 209, 0.22)';
        c.fillRect(VIEW_W / 2 - bw / 2, iy - 15, bw, 30);
        c.strokeStyle = 'rgba(126, 200, 255, 0.85)';
        c.lineWidth = 1;
        c.strokeRect(VIEW_W / 2 - bw / 2 + 0.5, iy - 14.5, bw - 1, 29);
        // 左右三角箭头（用路径绘制，不依赖字体字形）
        c.fillStyle = '#7ec8ff';
        c.beginPath();
        c.moveTo(VIEW_W / 2 - bw / 2 + 12, iy - 5);
        c.lineTo(VIEW_W / 2 - bw / 2 + 12, iy + 5);
        c.lineTo(VIEW_W / 2 - bw / 2 + 19, iy);
        c.closePath();
        c.fill();
        c.beginPath();
        c.moveTo(VIEW_W / 2 + bw / 2 - 12, iy - 5);
        c.lineTo(VIEW_W / 2 + bw / 2 - 12, iy + 5);
        c.lineTo(VIEW_W / 2 + bw / 2 - 19, iy);
        c.closePath();
        c.fill();
      }
      c.font = '14px "Microsoft YaHei", sans-serif';
      c.fillStyle = sel ? '#eaf6ff' : '#b8bcc8';
      c.fillText(it, VIEW_W / 2, iy);
    });

    if (this.titleHelp) {
      this.panel(VIEW_W / 2 - 180, 300, 360, 130);
      c.font = '11px "Microsoft YaHei", sans-serif';
      c.fillStyle = '#c8ccd8';
      const helps = [
        'WASD / 方向键 — 移动',
        'J / 空格 — 攻击',
        'E / Enter — 对话 · 开箱 · 确认',
        'K — 喝药水 · Esc — 暂停菜单',
        '提示：宝箱和商店能拿到更好的装备',
      ];
      helps.forEach((h, i) => c.fillText(h, VIEW_W / 2, 322 + i * 20));
    } else {
      c.font = '11px "Microsoft YaHei", sans-serif';
      c.fillStyle = '#5a6270';
      c.fillText('按 H 查看操作说明', VIEW_W / 2, 330);
    }

    c.font = '10px "Microsoft YaHei", sans-serif';
    c.fillStyle = '#4a5060';
    c.fillText('Arch Web OS · Abyss Echo', VIEW_W / 2, VIEW_H - 16);
    c.textAlign = 'left';
  }
}
