import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import type { Profile } from '../../../contracts/api.ts';

const scryptAsync = promisify(scrypt);

export class IdentityRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }

  /**
   * Idempotent: creating an account twice never consumes quota. The guest-creation
   * quota is enforced by the session route through `reserveGuestCreation`, so
   * internal callers (tests, migrations) cannot exhaust the public allowance.
   */
  async ensureGuest(userId: string) {
    await this.db.transaction(userId, async (sql) => {
      const exists = (await sql.query('SELECT 1 FROM parallel_life.accounts WHERE id=$1', [userId]))
        .rowCount;
      if (!exists && !(await sql.query('SELECT true ok')).rows[0]?.ok)
        throw Object.assign(new Error('RATE_LIMITED'), { code: 'RATE_LIMITED' });
      await sql.query('INSERT INTO parallel_life.accounts(id) VALUES($1) ON CONFLICT DO NOTHING', [
        userId,
      ]);
      const profile: Profile = {
        id: randomUUID(),
        version: 0,
        facts: [],
        events: [],
        people: [],
        portraitAssetId: null,
        referenceAssetIds: [],
        updatedAt: new Date().toISOString(),
      };
      await sql.query(
        'INSERT INTO parallel_life.profiles(id,owner_id,document) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO NOTHING',
        [profile.id, userId, profile],
      );
      await sql.query(
        'INSERT INTO parallel_life.interviews(id,owner_id) VALUES($1,$2) ON CONFLICT(owner_id) DO NOTHING',
        [randomUUID(), userId],
      );
    });
  }

  async exists(userId: string) {
    return this.db.transaction(
      userId,
      async (sql) =>
        !!(await sql.query('SELECT 1 FROM parallel_life.accounts WHERE id=$1', [userId])).rowCount,
    );
  }

  async getAccountInfo(userId: string): Promise<{ kind: 'guest' | 'account'; identifier: string | null } | null> {
    return this.db.transaction(userId, async (sql) => {
      const res = await sql.query(
        'SELECT a.kind, c.identifier FROM parallel_life.accounts a LEFT JOIN parallel_life.account_credentials c ON c.account_id = a.id WHERE a.id = $1',
        [userId],
      );
      if (!res.rows[0]) return null;
      return {
        kind: res.rows[0].kind as 'guest' | 'account',
        identifier: res.rows[0].identifier ?? null,
      };
    });
  }

  private async hashPassword(password: string, salt: string): Promise<string> {
    const derived = (await scryptAsync(password, salt, 64)) as Buffer;
    return derived.toString('hex');
  }

  /**
   * Register a new official account.
   * If currentGuestId is provided and mergeGuest is true, promotes the guest directly
   * so all guest data is preserved under the new credentials without moving records.
   */
  async registerAccount(params: {
    identifier: string;
    password: string;
    currentGuestId?: string | null;
    mergeGuest?: boolean;
  }): Promise<{ accountId: string; identifier: string; mergedGuest: boolean }> {
    const salt = randomBytes(16).toString('hex');
    const passwordHash = await this.hashPassword(params.password, salt);
    const normIdentifier = params.identifier.trim().toLowerCase();

    // Determine accountId: if promoting existing guest, reuse its ID directly!
    const targetAccountId =
      params.mergeGuest && params.currentGuestId ? params.currentGuestId : randomUUID();

    return this.db.transaction(targetAccountId, async (sql) => {
      try {
        const res = await sql.query(
          'SELECT parallel_life.register_account_credentials($1, $2, $3, $4) as result',
          [targetAccountId, normIdentifier, passwordHash, salt],
        );
        const result = res.rows[0]?.result;

        // Ensure profile and interview rows exist for the official account
        const profile: Profile = {
          id: randomUUID(),
          version: 0,
          facts: [],
          events: [],
          people: [],
          portraitAssetId: null,
          referenceAssetIds: [],
          updatedAt: new Date().toISOString(),
        };
        await sql.query(
          'INSERT INTO parallel_life.profiles(id,owner_id,document) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO NOTHING',
          [profile.id, targetAccountId, profile],
        );
        await sql.query(
          'INSERT INTO parallel_life.interviews(id,owner_id) VALUES($1,$2) ON CONFLICT(owner_id) DO NOTHING',
          [randomUUID(), targetAccountId],
        );

        return {
          accountId: result.accountId,
          identifier: result.identifier,
          mergedGuest: Boolean(params.mergeGuest && params.currentGuestId),
        };
      } catch (err: unknown) {
        const pgErr = err as { code?: string; message?: string };
        if (pgErr.code === '23505' || pgErr.message?.includes('CONFLICT')) {
          throw Object.assign(new Error('该账号已被注册，请直接登录。'), { code: 'CONFLICT' });
        }
        throw err;
      }
    });
  }

  /**
   * Authenticate with identifier and password.
   * If mergeGuest is requested, transfers currentGuestId's data into the account.
   */
  async loginAccount(params: {
    identifier: string;
    password: string;
    currentGuestId?: string | null;
    mergeGuest?: boolean;
  }): Promise<{ accountId: string; identifier: string; mergedGuest: boolean }> {
    const normIdentifier = params.identifier.trim().toLowerCase();

    // 1. Look up credentials
    const creds = await this.db.transaction('system-auth', async (sql) => {
      const res = await sql.query(
        'SELECT account_id, identifier, password_hash, salt, kind FROM parallel_life.lookup_account_credential($1)',
        [normIdentifier],
      );
      return res.rows[0];
    });

    if (!creds) {
      throw Object.assign(new Error('账号或密码不正确。'), { code: 'UNAUTHORIZED' });
    }

    // 2. Verify password hash using constant-time comparison
    const computedHash = await this.hashPassword(params.password, creds.salt);
    const match =
      computedHash.length === creds.password_hash.length &&
      timingSafeEqual(Buffer.from(computedHash), Buffer.from(creds.password_hash));

    if (!match) {
      throw Object.assign(new Error('账号或密码不正确。'), { code: 'UNAUTHORIZED' });
    }

    let mergedGuest = false;

    // 3. Merge guest data if requested and distinct
    if (
      params.mergeGuest &&
      params.currentGuestId &&
      params.currentGuestId !== creds.account_id
    ) {
      await this.db.transaction(creds.account_id, async (sql) => {
        const res = await sql.query(
          'SELECT parallel_life.merge_guest_into_account($1, $2) res',
          [params.currentGuestId, creds.account_id],
        );
        const result = res.rows[0]?.res as { merged?: boolean } | undefined;
        if (result?.merged) {
          mergedGuest = true;
        }
      });
    }

    return {
      accountId: creds.account_id,
      identifier: creds.identifier,
      mergedGuest,
    };
  }

  /**
   * Reserves one guest-creation slot for this caller. Returns false when the
   * caller (or the global ceiling) is over its window, so the route can answer
   * 429 without creating an account.
   */
  async reserveGuestCreation(
    bucket: string,
    limits: {
      perCaller: number;
      ceiling: number;
      windowSeconds: number;
    },
  ): Promise<boolean> {
    return this.db.transaction(bucket, async (sql) => {
      const row = (
        await sql.query('SELECT parallel_life.reserve_guest_key($1,$2,$3,$4) ok', [
          bucket,
          limits.perCaller,
          limits.ceiling,
          limits.windowSeconds,
        ])
      ).rows[0];
      return Boolean(row?.ok);
    });
  }
}
