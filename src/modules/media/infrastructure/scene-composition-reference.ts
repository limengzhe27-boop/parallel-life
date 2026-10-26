import sharp from 'sharp';
import { worldDateTimeLabel } from '../../world/domain/display-time.ts';

export type SceneCompositionPicture = { assetId: string; bytes: Buffer; mimeType: string };
export type SceneCompositionPerson = SceneCompositionPicture & { actorId: string; name: string };
/** Contact sheet is a model input, never a displayed finished scene. */
export async function composeSceneReference(input: {
  place: SceneCompositionPicture | null;
  placeName?: string;
  storyAt?: string;
  people: readonly SceneCompositionPerson[];
}) {
  if (input.people.length > 6)
    throw Object.assign(new Error('SCENE_REFERENCE_CAPACITY'), {
      code: 'INVALID_INPUT',
      responseOutcome: 'not_sent',
    });
  if (!input.place && !input.people.length) return null;
  const width = 1200;
  const placeHeight = input.place ? 720 : 0;
  const columns = Math.min(3, Math.max(input.people.length, 1));
  const rows = Math.ceil(input.people.length / columns);
  const cellWidth = Math.floor(width / columns);
  const cellHeight = 650;
  const overlays: { input: Buffer; left: number; top: number }[] = [];
  if (input.place)
    overlays.push({
      input: await sharp(input.place.bytes, { limitInputPixels: 25_000_000 })
        .rotate()
        .resize(width, placeHeight, { fit: 'contain', background: '#d4d1ca' })
        .png()
        .toBuffer(),
      left: 0,
      top: 0,
    });
  for (const [i, person] of input.people.entries())
    overlays.push({
      input: await sharp(person.bytes, { limitInputPixels: 25_000_000 })
        .rotate()
        .resize(cellWidth, cellHeight, { fit: 'contain', background: '#d4d1ca' })
        .png()
        .toBuffer(),
      left: (i % columns) * cellWidth,
      top: placeHeight + Math.floor(i / columns) * cellHeight,
    });
  const bytes = await sharp({
    create: { width, height: placeHeight + rows * cellHeight, channels: 3, background: '#d4d1ca' },
  })
    .composite(overlays)
    .png()
    .toBuffer();
  const prompt = [
    'Create one seamless immersive photorealistic visual-novel scene, vertical 9:16, from the viewer/player eye level. This input is a reference contact sheet, NOT the desired output layout. No collage, panels, borders, text, UI or repeated people.',
    input.placeName
      ? `The actual established location is ${input.placeName}. ${input.storyAt ? 'Current local story time: ' + worldDateTimeLabel(input.storyAt) + '.' : ''} Match this location and time; do not substitute an unrelated place.`
      : '',
    input.place
      ? 'The top panel is the actual location reference. Preserve its architecture and distinctive furniture and landmarks. Recompose the camera naturally within this place.'
      : 'Use the established place and observable scene description; do not invent a new location.',
    input.people.length
      ? `Below it are exactly ${input.people.length} different character identity references, read left to right then next row: ${input.people.map((p, i) => `${i + 1}: ${p.name}`).join('; ')}. Depict these same people once each, preserve each face, original age, hair and current opaque clothing. Place them naturally in the environment with unified lighting, perspective, scale and believable seated/standing posture justified by the scene. Do not show the player as an extra person; this is the player viewpoint.`
      : 'No other people are present. Depict the empty established location, not invented bystanders.',
    'Use a natural medium-close player viewpoint with the faces clearly visible in the upper third. Render the continuous physical environment edge to edge, including the entire lower half with real clothing, furniture, table or floor. No empty panels, blank space, black bars, artificial dark gradients, vignettes, fades or text-safe zones. Do not invent new actions, romantic contact, injuries, objects or completed outcomes absent from the observable scene.',
  ].join(' ');
  return {
    assetId: input.place?.assetId ?? input.people[0]!.assetId,
    referenceAssetIds: [
      ...(input.place ? [input.place.assetId] : []),
      ...input.people.map((p) => p.assetId),
    ],
    bytes,
    mimeType: 'image/png',
    compositionPrompt: prompt,
  };
}
