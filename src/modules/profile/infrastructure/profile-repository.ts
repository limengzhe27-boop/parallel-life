import {
  groundPersonProposal,
  explicitPhotoPeople,
  resolvePhotoReference,
  isStoryPersonContext,
  type PersonProposal,
} from '../application/person-extraction.ts';
import { createHash, randomUUID } from 'node:crypto';
import {
  LifeDate,
  ProfileSchema,
  ProfileEditSchema,
  type ProfileEdit,
} from '../../../contracts/api.ts';
import type { MemoryCandidate } from '../../../contracts/memory.ts';
import {
  collectBasicInfo,
  legacyBirthday,
  readBasicInfo,
  writeBasicInfo,
} from '../domain/profile-view.ts';
import { extractBasicInfoFromText } from './interview-planner.ts';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';

/**
 * Apply a user-confirmed memory candidate while holding the profile row lock.
 * Candidate confirmation calls this inside its own transaction so the candidate
 * cannot become confirmed without the corresponding reality-profile update.
 */
function cleanForMatch(s: string) {
  return s.replace(/[，。！？、；：“”‘’\s,.!?;:'"]/g, '').toLowerCase();
}

export function isSimilarText(a: string, b: string): boolean {
  // Auto-merging loses the second claim and attaches its source to the first.
  // Shared phrases such as “我喜欢”/“我想成为” cannot prove that the objects match.
  // Only punctuation, the self-pronoun and a few emphasis modifiers are ignored;
  // paraphrases remain separate until a user can review them.
  const normalize = (text: string) =>
    cleanForMatch(text)
      .replace(/^我/u, '')
      .replace(/^(?:(?:还是|一直|确实|真的|特别|非常|比较|很))+/u, '');
  const ca = normalize(a);
  return ca.length > 0 && ca === normalize(b);
}

type BasicInfoInput = {
  name?: string;
  birthdate?: string;
  birthTime?: string;
  location?: string;
  occupation?: string;
  hometown?: string;
};

export async function applyConfirmedCandidateInTransaction(
  sql: import('../../storage/infrastructure/postgres.ts').SqlClient,
  ownerId: string,
  candidate: Pick<MemoryCandidate, 'category' | 'text' | 'eventDate' | 'sourceMessageIds'>,
  now = new Date().toISOString(),
) {
  if (candidate.category === 'identity') {
    const sourceIds = [...new Set(candidate.sourceMessageIds)];
    const sources = await sql.query(
      "SELECT id,text FROM parallel_life.interview_messages WHERE owner_id=$1 AND role='user' AND id=ANY($2::uuid[])",
      [ownerId, sourceIds],
    );
    if (!sourceIds.length || sources.rowCount !== sourceIds.length)
      throw new TaskError('INVALID_INPUT');
    const basicInfo: BasicInfoInput = Object.assign(
      {},
      ...sources.rows.map((row) => extractBasicInfoFromText(String(row.text))),
    );
    if (!Object.values(basicInfo).some(Boolean)) throw new TaskError('INVALID_INPUT');
    const claimedBirthday = legacyBirthday(candidate.text);
    if (claimedBirthday && basicInfo.birthdate !== claimedBirthday)
      throw new TaskError('INVALID_INPUT');
    if (claimedBirthday)
      for (const key of Object.keys(basicInfo) as (keyof BasicInfoInput)[]) {
        if (key !== 'birthdate') delete basicInfo[key];
      }
    return (await applyBasicInfoInTransaction(sql, ownerId, basicInfo, sourceIds, now, true))
      .profile;
  }
  const row = (
    await sql.query(
      'SELECT document,version FROM parallel_life.profiles WHERE owner_id=$1 FOR UPDATE',
      [ownerId],
    )
  ).rows[0];
  if (!row) throw new TaskError('NOT_FOUND');
  const profile = ProfileSchema.parse({ ...row.document, version: Number(row.version) });
  if (candidate.category === 'experience') {
    if (candidate.text.length > 120) throw new TaskError('INVALID_INPUT');
    const date = candidate.eventDate ?? null;
    const existing = profile.events.find(
      (event) =>
        (event.title === candidate.text || isSimilarText(event.title, candidate.text)) &&
        (event.date === date || !event.date || !date),
    );
    if (existing) {
      if (!existing.date && date) existing.date = date;
      existing.sourceMessageIds = [
        ...new Set([...existing.sourceMessageIds, ...candidate.sourceMessageIds]),
      ].slice(0, 20);
    } else {
      if (profile.events.length >= 100) throw new TaskError('INVALID_INPUT');
      profile.events.push({
        id: randomUUID(),
        title: candidate.text,
        date,
        feeling: null,
        sourceMessageIds: candidate.sourceMessageIds.slice(0, 20),
      });
    }
  } else {
    if (candidate.text.length > 500) throw new TaskError('INVALID_INPUT');
    const existing = profile.facts.find(
      (fact) =>
        fact.category === candidate.category &&
        (fact.value === candidate.text || isSimilarText(fact.value, candidate.text)) &&
        fact.status !== 'rejected',
    );
    if (existing) {
      existing.status = 'confirmed';
      existing.sourceMessageIds = [
        ...new Set([...existing.sourceMessageIds, ...candidate.sourceMessageIds]),
      ].slice(0, 20);
      existing.updatedAt = now;
    } else {
      if (profile.facts.length >= 200) throw new TaskError('INVALID_INPUT');
      profile.facts.push({
        id: randomUUID(),
        category: candidate.category,
        value: candidate.text,
        status: 'confirmed',
        sourceMessageIds: candidate.sourceMessageIds.slice(0, 20),
        updatedAt: now,
      });
    }
  }
  profile.version = Number(row.version) + 1;
  profile.updatedAt = now;
  const validated = ProfileSchema.parse(profile);
  await sql.query(
    'UPDATE parallel_life.profiles SET version=$2,document=$3,updated_at=now() WHERE owner_id=$1',
    [ownerId, profile.version, validated],
  );
  return validated;
}

export async function applyBasicInfoInTransaction(
  sql: import('../../storage/infrastructure/postgres.ts').SqlClient,
  ownerId: string,
  basicInfo: BasicInfoInput,
  sourceMessageIds: string[] = [],
  now = new Date().toISOString(),
  forceBirthdate = false,
) {
  const row = (
    await sql.query(
      'SELECT document,version FROM parallel_life.profiles WHERE owner_id=$1 FOR UPDATE',
      [ownerId],
    )
  ).rows[0];
  if (!row) throw new TaskError('NOT_FOUND');
  const profile = ProfileSchema.parse({ ...row.document, version: Number(row.version) });

  const existingFact = collectBasicInfo(profile).canonical;

  const currentValues = readBasicInfo(existingFact?.value ?? '个人资料\n').values;
  const birthdate = basicInfo.birthdate?.trim();
  if (birthdate && !LifeDate.safeParse(birthdate).success) throw new TaskError('INVALID_INPUT');
  const priorBirthdays = collectBasicInfo(profile).birthdateClaims;
  const fieldLabels: [keyof typeof currentValues | '生日', string | undefined][] = [
    ['姓名', basicInfo.name],
    ['生日', birthdate],
    ['出生时间', basicInfo.birthTime],
    ['所在城市', basicInfo.location],
    ['职业', basicInfo.occupation],
    ['家乡', basicInfo.hometown],
  ];
  let hasChange = false;
  let disputedBirthdate: string | null = null;
  for (const [label, newVal] of fieldLabels) {
    const value = newVal?.trim();
    if (!value || currentValues[label] === value) continue;
    if (
      label === '生日' &&
      !forceBirthdate &&
      priorBirthdays.some(
        (prior) =>
          prior !== value && !prior.startsWith(`${value}-`) && !value.startsWith(`${prior}-`),
      )
    ) {
      disputedBirthdate = value;
      continue;
    }
    if (label === '生日' && currentValues['生日'] && !forceBirthdate) {
      const old = currentValues['生日'];
      if (value.startsWith(`${old}-`)) {
        // A later precise self-report may enrich a known year/month.
      } else if (old.startsWith(`${value}-`)) {
        // A repeated year cannot erase an already known month and day.
        continue;
      } else {
        disputedBirthdate = value;
        continue;
      }
    }
    currentValues[label] = value;
    hasChange = true;
  }
  const acceptedEvidence = fieldLabels.some(
    ([label, value]) => value?.trim() && currentValues[label] === value.trim(),
  );
  const nextSources = existingFact
    ? [
        ...new Set([
          ...existingFact.sourceMessageIds,
          ...(acceptedEvidence ? sourceMessageIds : []),
        ]),
      ].slice(0, 20)
    : sourceMessageIds.slice(0, 20);
  if (existingFact && nextSources.length !== existingFact.sourceMessageIds.length) hasChange = true;
  if (
    forceBirthdate &&
    birthdate &&
    profile.facts.some(
      (fact) =>
        fact.id !== existingFact?.id && fact.category === 'identity' && legacyBirthday(fact.value),
    )
  )
    hasChange = true;
  if (!hasChange) return { profile, disputedBirthdate };
  const newValue = writeBasicInfo(existingFact?.value, currentValues);

  if (existingFact) {
    existingFact.value = newValue;
    existingFact.status = 'confirmed';
    existingFact.updatedAt = now;
    existingFact.sourceMessageIds = nextSources;
  } else {
    if (profile.facts.length >= 200) throw new TaskError('INVALID_INPUT');
    profile.facts.push({
      id: randomUUID(),
      category: 'identity',
      value: newValue,
      status: 'confirmed',
      sourceMessageIds: nextSources,
      updatedAt: now,
    });
  }

  if (forceBirthdate && birthdate) {
    for (const fact of profile.facts) {
      if (
        fact.id !== existingFact?.id &&
        fact.category === 'identity' &&
        legacyBirthday(fact.value)
      ) {
        fact.status = 'rejected';
        fact.updatedAt = now;
      }
    }
  }

  profile.version = Number(row.version) + 1;
  profile.updatedAt = now;
  const validated = ProfileSchema.parse(profile);
  await sql.query(
    'UPDATE parallel_life.profiles SET version=$2,document=$3,updated_at=now() WHERE owner_id=$1',
    [ownerId, profile.version, validated],
  );
  return { profile: validated, disputedBirthdate };
}

export class ProfileRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async get(ownerId: string) {
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query('SELECT document,version FROM parallel_life.profiles WHERE owner_id=$1', [
          ownerId,
        ])
      ).rows[0];
      if (!row) throw new TaskError('NOT_FOUND');
      return ProfileSchema.parse({ ...row.document, version: row.version });
    });
  }
  async edit(ownerId: string, raw: ProfileEdit) {
    const input = ProfileEditSchema.parse(raw),
      hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.db.transaction(ownerId, async (sql) => {
      await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [ownerId]);
      if (input.commandId) {
        const old = (
          await sql.query(
            'SELECT request_hash,response FROM parallel_life.profile_edit_receipts WHERE owner_id=$1 AND command_id=$2',
            [ownerId, input.commandId],
          )
        ).rows[0];
        if (old) {
          if (old.request_hash !== hash) throw new TaskError('IDEMPOTENCY_CONFLICT');
          return ProfileSchema.parse(old.response);
        }
      }
      const row = (
        await sql.query(
          'SELECT document,version FROM parallel_life.profiles WHERE owner_id=$1 FOR UPDATE',
          [ownerId],
        )
      ).rows[0];
      if (!row) throw new TaskError('NOT_FOUND');
      if (row.version !== input.expectedVersion) throw new TaskError('VERSION_CONFLICT');
      const profile = ProfileSchema.parse({ ...row.document, version: row.version }),
        op = input.operation,
        now = new Date().toISOString();
      switch (op.kind) {
        case 'set-fact': {
          if (op.category === 'identity') {
            if (!op.value.startsWith('个人资料\n')) throw new TaskError('INVALID_INPUT');
            const birthday = readBasicInfo(op.value).values['生日'];
            if (birthday && !LifeDate.safeParse(birthday).success)
              throw new TaskError('INVALID_INPUT');
            const canonical = collectBasicInfo(profile).canonical;
            if (canonical && op.id !== canonical.id) throw new TaskError('INVALID_INPUT');
          }
          const existing = op.id ? profile.facts.find((f) => f.id === op.id) : null;
          if (op.id && !existing) throw new TaskError('NOT_FOUND');
          if (!existing && profile.facts.length >= 200) throw new TaskError('INVALID_INPUT');
          if (existing)
            Object.assign(existing, {
              category: op.category,
              value: op.value,
              status: 'confirmed',
              sourceMessageIds: [],
              updatedAt: now,
            });
          else
            profile.facts.push({
              id: randomUUID(),
              category: op.category,
              value: op.value,
              status: 'confirmed',
              sourceMessageIds: [],
              updatedAt: now,
            });
          if (op.category === 'identity') {
            const birthday = readBasicInfo(op.value).values['生日'];
            if (birthday)
              for (const fact of profile.facts) {
                if (
                  fact.id !== existing?.id &&
                  fact.category === 'identity' &&
                  legacyBirthday(fact.value)
                ) {
                  fact.status = 'rejected';
                  fact.updatedAt = now;
                }
              }
          }
          break;
        }
        case 'confirm-fact':
        case 'delete-fact': {
          const fact = profile.facts.find((f) => f.id === op.id);
          if (!fact) throw new TaskError('NOT_FOUND');
          fact.status = op.kind === 'confirm-fact' ? 'confirmed' : 'rejected';
          fact.updatedAt = now;
          break;
        }
        case 'set-event': {
          const index = profile.events.findIndex((e) => e.id === op.event.id);
          const event = { ...op.event, sourceMessageIds: [] };
          if (index < 0) {
            if (profile.events.length >= 100) throw new TaskError('INVALID_INPUT');
            profile.events.push(event);
          } else profile.events[index] = event;
          break;
        }
        case 'delete-event': {
          if (!profile.events.some((e) => e.id === op.id)) throw new TaskError('NOT_FOUND');
          profile.events = profile.events.filter((e) => e.id !== op.id);
          break;
        }
        case 'set-person': {
          if (
            op.person.assetId &&
            !(
              await sql.query(
                "SELECT id FROM parallel_life.assets WHERE id=$1 AND status='ready' AND origin='upload' AND world_id IS NULL FOR SHARE",
                [op.person.assetId],
              )
            ).rowCount
          )
            throw new TaskError('NOT_FOUND');
          const index = profile.people.findIndex((p) => p.id === op.person.id);
          const previous = profile.people[index];
          const enhanced =
            'knownName' in op.person ||
            'temporaryLabel' in op.person ||
            'interaction' in op.person ||
            'experiences' in op.person ||
            !!previous?.origin;
          const savedPerson = enhanced
            ? {
                ...previous,
                ...op.person,
                ...(!('knownName' in op.person || 'temporaryLabel' in op.person)
                  ? { knownName: null, temporaryLabel: op.person.name }
                  : {}),
                origin: 'manual' as const,
                sourceMessageIds: previous?.sourceMessageIds ?? [],
                sourceQuotes: previous?.sourceQuotes ?? [],
                updatedAt: now,
              }
            : op.person;
          if (index < 0) {
            if (profile.people.length >= 30) throw new TaskError('INVALID_INPUT');
            profile.people.push(savedPerson);
          } else profile.people[index] = savedPerson;
          break;
        }
        case 'delete-person': {
          if (!profile.people.some((p) => p.id === op.id)) throw new TaskError('NOT_FOUND');
          profile.people = profile.people.filter((p) => p.id !== op.id);
          break;
        }
        case 'set-portrait': {
          if (
            op.assetId &&
            !(
              await sql.query(
                "SELECT id FROM parallel_life.assets WHERE id=$1 AND status='ready' FOR SHARE",
                [op.assetId],
              )
            ).rowCount
          )
            throw new TaskError('NOT_FOUND');
          profile.portraitAssetId = op.assetId;
          if (op.assetId && !profile.referenceAssetIds.includes(op.assetId)) {
            profile.referenceAssetIds.push(op.assetId);
          }
          break;
        }
        case 'add-reference-photo': {
          if (
            !(
              await sql.query(
                "SELECT id FROM parallel_life.assets WHERE id=$1 AND status='ready' FOR SHARE",
                [op.assetId],
              )
            ).rowCount
          )
            throw new TaskError('NOT_FOUND');
          if (!profile.referenceAssetIds.includes(op.assetId)) {
            if (profile.referenceAssetIds.length >= 6) throw new TaskError('INVALID_INPUT');
            profile.referenceAssetIds.push(op.assetId);
          }
          // Sharing grants interview access; only set-portrait designates the user’s own portrait.
          break;
        }
        case 'delete-reference-photo': {
          if (!profile.referenceAssetIds.includes(op.assetId)) throw new TaskError('NOT_FOUND');
          profile.referenceAssetIds = profile.referenceAssetIds.filter((id) => id !== op.assetId);
          if (profile.portraitAssetId === op.assetId) {
            profile.portraitAssetId = null;
          }
          break;
        }
      }
      profile.version++;
      profile.updatedAt = now;
      const validated = ProfileSchema.parse(profile);
      await sql.query(
        'UPDATE parallel_life.profiles SET version=$2,document=$3,updated_at=now() WHERE owner_id=$1',
        [ownerId, profile.version, validated],
      );
      if (input.commandId)
        await sql.query(
          'INSERT INTO parallel_life.profile_edit_receipts(owner_id,command_id,request_hash,response) VALUES($1,$2,$3,$4)',
          [ownerId, input.commandId, hash, validated],
        );
      return validated;
    });
  }
}

/** Same transaction as the assistant message, task receipt and interview version. */
export async function applyPeopleInTransaction(
  sql: import('../../storage/infrastructure/postgres.ts').SqlClient,
  ownerId: string,
  interviewId: string,
  inputMessageId: string,
  expectedProfileVersion: number,
  proposals: PersonProposal[] = [],
) {
  const row = (
    await sql.query(
      'SELECT document,version FROM parallel_life.profiles WHERE owner_id=$1 FOR UPDATE',
      [ownerId],
    )
  ).rows[0];
  // A slow model must not recreate a manually deleted person or overwrite a manual edit.
  if (!row || Number(row.version) !== expectedProfileVersion) return;
  const source = (
    await sql.query(
      "SELECT id,text,photo_asset_id,created_at,ordinal FROM parallel_life.interview_messages WHERE id=$1 AND owner_id=$2 AND interview_id=$3 AND role='user'",
      [inputMessageId, ownerId, interviewId],
    )
  ).rows[0];
  if (!source) return;
  const profile = ProfileSchema.parse({ ...row.document, version: Number(row.version) });
  let changed = false;
  const history = (
    await sql.query(
      "SELECT id,text,photo_asset_id,created_at FROM parallel_life.interview_messages WHERE owner_id=$1 AND interview_id=$2 AND role='user' AND ordinal<$3 ORDER BY ordinal DESC LIMIT 40",
      [ownerId, interviewId, source.ordinal],
    )
  ).rows
    .reverse()
    .map((m) => ({
      id: String(m.id),
      text: String(m.text),
      photoAssetId: m.photo_asset_id ? String(m.photo_asset_id) : null,
      createdAt: new Date(m.created_at).toISOString(),
    }));
  const photoLabelsOnly = isStoryPersonContext(
    String(source.text),
    history.map((m) => m.text),
  );
  const evidence = {
    id: inputMessageId,
    text: String(source.text),
    photoAssetId: source.photo_asset_id ? String(source.photo_asset_id) : null,
    createdAt: new Date(source.created_at).toISOString(),
  };
  // Literal per-photo attribution works even if the single model call omits people.
  const literal = explicitPhotoPeople(evidence.text, inputMessageId);
  const items = [
    ...literal,
    ...proposals.filter(
      (p) =>
        !literal.some((l) => l.subject === p.subject && (p.associatePhoto || l.quote === p.quote)),
    ),
  ];
  const references = items.map((p) =>
    p.associatePhoto ? resolvePhotoReference(evidence, history, p.quote, p.subject) : null,
  );
  for (const [index, proposal] of items.entries()) {
    if (proposal.messageId !== inputMessageId) continue;
    const grounded = groundPersonProposal(
      proposal,
      String(source.text),
      profile.people,
      photoLabelsOnly,
    );
    if (!grounded) continue;
    if (grounded.associatePhoto && !references[index]) continue;
    let assetId: string | null = null;
    let photoSource = references[index];
    // Conflicting claims to one photo cannot assign it to multiple people.
    if (photoSource && references.filter((r) => r?.id === photoSource?.id).length !== 1)
      photoSource = null;
    if (grounded.associatePhoto && photoSource && photoSource.photoAssetId) {
      const asset = await sql.query(
        "SELECT id FROM parallel_life.assets WHERE id=$1 AND owner_id=$2 AND status='ready' AND origin='upload' AND world_id IS NULL FOR SHARE",
        [photoSource.photoAssetId, ownerId],
      );
      if (asset.rowCount && profile.referenceAssetIds.includes(photoSource.photoAssetId))
        assetId = photoSource.photoAssetId;
    }
    if (grounded.photoLabel && !assetId) continue;
    if (!grounded.knownName && !grounded.description && !grounded.experience && !assetId) continue;
    const previous = grounded.photoLabel
      ? profile.people.find(
          (p) =>
            p.assetId === assetId &&
            assetId &&
            p.relationship === '照片人物' &&
            p.temporaryLabel === grounded.subject,
        )
      : profile.people.find((p) => p.id === grounded.existingId);
    if (previous?.assetId && assetId && previous.assetId !== assetId) continue;
    if (!previous && profile.people.length >= 30) continue;
    // An already-attributed image cannot silently identify a different person/label.
    if (assetId && profile.people.some((p) => p.assetId === assetId && p.id !== previous?.id))
      continue;
    const nextSources = [
      ...new Set([
        ...(previous?.sourceMessageIds ?? []),
        inputMessageId,
        ...(assetId && photoSource ? [photoSource.id] : []),
      ]),
    ];
    const nextQuotes = [...(previous?.sourceQuotes ?? [])];
    for (const quote of [
      { interviewId, messageId: inputMessageId, quote: grounded.quote },
      ...(assetId && photoSource && photoSource.id !== inputMessageId
        ? [{ interviewId, messageId: photoSource.id, quote: photoSource.text.slice(0, 1000) }]
        : []),
    ])
      if (!nextQuotes.some((q) => q.messageId === quote.messageId && q.quote === quote.quote))
        nextQuotes.push(quote);
    // Capacity must include both the label and photo evidence before any mutation; never truncate evidence.
    if (nextSources.length > 40 || nextQuotes.length > 40) continue;
    const person = previous ?? {
      id: randomUUID(),
      name: grounded.photoLabel ? grounded.subject : (grounded.knownName ?? grounded.subject),
      knownName: grounded.photoLabel ? null : (grounded.knownName ?? null),
      temporaryLabel: grounded.subject,
      relationship: grounded.photoLabel ? '照片人物' : grounded.subject,
      assetId: null,
      interaction: '',
      experiences: [],
      sourceMessageIds: [],
      sourceQuotes: [],
      origin: 'interview' as const,
    };
    const before = JSON.stringify(person);
    if (!grounded.photoLabel && grounded.knownName && !person.knownName) {
      person.knownName = grounded.knownName;
      person.name = grounded.knownName;
    }
    if (
      !grounded.photoLabel &&
      grounded.description &&
      !(person.interaction ?? '').includes(grounded.description)
    ) {
      const description = [person.interaction, grounded.description].filter(Boolean).join('；');
      if (description.length <= 1200) person.interaction = description;
    }
    if (
      !grounded.photoLabel &&
      grounded.experience &&
      !person.experiences?.some((e) => e.text === grounded.experience)
    ) {
      const experiences = person.experiences ?? [];
      if (experiences.length < 10)
        person.experiences = [
          ...experiences,
          { id: randomUUID(), text: grounded.experience, date: null },
        ];
    }
    if (assetId && (!person.assetId || person.assetId === assetId)) person.assetId = assetId;
    else if (assetId) assetId = null;
    person.sourceMessageIds = nextSources;
    person.sourceQuotes = nextQuotes;
    if (!previous || JSON.stringify(person) !== before) {
      person.updatedAt = new Date().toISOString();
      person.origin ??= 'interview';
      if (!previous) profile.people.push(person);
      changed = true;
    }
  }
  if (!changed) return;
  profile.version++;
  profile.updatedAt = new Date().toISOString();
  const document = ProfileSchema.parse(profile);
  await sql.query(
    'UPDATE parallel_life.profiles SET document=$2::jsonb,version=$3,updated_at=$4 WHERE owner_id=$1',
    [ownerId, JSON.stringify(document), document.version, document.updatedAt],
  );
}
