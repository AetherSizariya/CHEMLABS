
import crypto from 'crypto';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { buildQuantityProfile, buildReactionCachePayload, makeReactionCode } from '../../src/lib/reactionProfile';
import { calculateDeterministicQuantities } from '../../src/lib/stoichiometry';
import { sanitizeFirestoreData } from '../../src/lib/firestoreSafe';


const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);


async function handleReact(body: any): Promise<Response> {
  try {
    const { action, sourceChemicals, targetEquipment, targetChemicals, amount, apiKeys, temperature, pressure, reactionTime } = body || {};
    if (!Array.isArray(apiKeys) || apiKeys.length === 0) {
      return Response.json({ error: 'Gemini API key required. Add your API key in Settings.' }, { status: 400 });
    }

    const allChemicals: any[] = [];
    if (Array.isArray(sourceChemicals)) allChemicals.push(...sourceChemicals);
    if (Array.isArray(targetChemicals)) allChemicals.push(...targetChemicals);

    const sourceLiquidVolumeMl = Number.isFinite(Number(body?.sourceLiquidVolumeMl))
      ? Math.max(0, Number(body.sourceLiquidVolumeMl))
      : 0;
    const targetLiquidVolumeMl = Number.isFinite(Number(body?.targetLiquidVolumeMl))
      ? Math.max(0, Number(body.targetLiquidVolumeMl))
      : 0;
    const inputLiquidVolumeMl =
      (sourceLiquidVolumeMl + targetLiquidVolumeMl) > 0
        ? sourceLiquidVolumeMl + targetLiquidVolumeMl
        : undefined;

    // Reaction identity deliberately excludes quantities. The same chemical
    // combination/conditions is one experiment; quantities are applied later
    // through the stored quantity profile.
    const payloadToHash = buildReactionCachePayload(body);
    const hash = crypto.createHash('sha256').update(JSON.stringify(payloadToHash)).digest('hex');
    const reactionCode = makeReactionCode(hash);
    const reactionDocRef = doc(db, 'reactions', hash);
    const cachedDoc = await getDoc(reactionDocRef);
    if (cachedDoc.exists()) {
      const cached = cachedDoc.data() as any;
      // Reuse identity / equation / visuals; recompute quantities for current inputs.
      if (cached?.chemicalEquation) {
        const deterministic = calculateDeterministicQuantities(
          cached.chemicalEquation,
          allChemicals,
          cached.resultingChemicals || [],
          Number(body?.temperature || 25),
          Number(body?.pressure || 1),
          inputLiquidVolumeMl
        );
        if (deterministic) {
          return Response.json({
            ...cached,
            ...deterministic,
            gasVolumeMl: deterministic.gasProduced ? (deterministic.gasVolumeMl ?? 0) : 0,
            reactionCode: cached.reactionCode || reactionCode,
            cached: true,
          });
        }
      }
    }

    let prompt = `I am simulating a virtual chemistry lab.`;
    if (action === 'heat') {
      const hasContents = Array.isArray(targetChemicals) && targetChemicals.length > 0;
      prompt += `\nI am intensely heating a ${targetEquipment} which contains ${hasContents ? targetChemicals.map((c: any) => `${c.amount}${c.chemical?.state === 'solid' ? 'g' : 'ml'} of ${c.chemical.name}`).join(' and ') : 'nothing'}. The current temperature is ${temperature || 25}°C.
Analyze the chemical reaction (e.g. decomposition, combustion, boiling) that occurs due to heating. If contents include combustible solids (Magnesium Ribbon, Coal, etc.) in contact with flame/heat, treat this as combustion in air and ALWAYS provide a chemicalEquation and visualEffect. If Magnesium Ribbon burns, ensure visualEffect includes 'white dazzling flame'. If Coal burns, ensure gasProduced is true and visualEffect reflects burning. If Hydrogen gas is present and ignited, set isPop to true.`;
    } else if (action === 'cool') {
      prompt += `\nI am cooling a ${targetEquipment} which contains ${Array.isArray(targetChemicals) && targetChemicals.length ? targetChemicals.map((c: any) => `${c.amount}ml of ${c.chemical.name}`).join(' and ') : 'nothing'} in an ice bath. The current temperature is ${temperature || 25}°C.\nAnalyze any chemical or physical reaction caused by cooling.`;
    } else if (action === 'photolyze') {
      prompt += `\nI am exposing a ${targetEquipment} which contains ${Array.isArray(targetChemicals) && targetChemicals.length ? targetChemicals.map((c: any) => `${c.amount}ml of ${c.chemical.name}`).join(' and ') : 'nothing'} to intense UV sunlight / light.\nAnalyze if any photolytic decomposition or photochemical reaction occurs.`;
    } else if (action === 'electrolyze') {
      prompt += `\nI am applying electricity (electrolysis) via electrodes to a ${targetEquipment} which contains ${Array.isArray(targetChemicals) && targetChemicals.length ? targetChemicals.map((c: any) => `${c.amount}ml of ${c.chemical.name}`).join(' and ') : 'nothing'}.\nAnalyze if any electrolytic decomposition or electrochemical reaction occurs.`;
    } else if (action === 'stir') {
      prompt += `\nI am vigorously stirring a ${targetEquipment} which contains ${Array.isArray(targetChemicals) && targetChemicals.length ? targetChemicals.map((c: any) => `${c.amount}ml of ${c.chemical.name}`).join(' and ') : 'nothing'}.\nAnalyze if stirring causes any reaction.`;
    } else {
      prompt += `\nI poured ${amount}ml of a mixture containing ${sourceChemicals?.map((c: any) => `${c.amount}ml of ${c.chemical.name}`).join(' and ')} into a ${targetEquipment} which currently contains ${Array.isArray(targetChemicals) && targetChemicals.length ? targetChemicals.map((c: any) => `${c.amount}ml of ${c.chemical.name}`).join(' and ') : 'nothing'}.\nAnalyze the chemical reaction that occurs upon mixing.`;
    }

    prompt += `
CRITICAL REQUIREMENTS FOR ACCURACY:
1. Base your answer on real-world chemistry and balanced chemical equations.
2. The user wants the outcome after: ${reactionTime || 'end of reaction'}, with reaction rate ${body?.reactionRate || 'normal'}.
3. Input amounts are ml for liquids/solutions and grams for solids.
4. Identify the balanced chemical equation and products. DO NOT calculate or guess product quantities. The server calculates final quantities and stored reaction ratios deterministically. If an amount field is required by the schema, it may be omitted or set to 0 because it is not authoritative.
5. If no reaction occurs, conserve the mixed contents.
6. resultIngChemicals contains only materials remaining inside the container. NEVER put gases in resultingChemicals.
7. Do not apply stoichiometric coefficients twice. Do not treat ml as moles or liters as ml.`;

    const gemini = await callGemini(apiKeys, prompt, reactionResponseSchema);
    if (!gemini.ok) return gemini.response;

    let result: any;
    try { result = JSON.parse(gemini.text); }
    catch { return Response.json({ error: 'Gemini returned invalid JSON for the structured reaction response.' }, { status: 502 }); }

    const deterministic = calculateDeterministicQuantities(
      result?.chemicalEquation || '',
      allChemicals,
      result?.resultingChemicals || [],
      Number(temperature || 25),
      Number(pressure || 1),
      inputLiquidVolumeMl
    );
    if (deterministic) result = { ...result, ...deterministic };

    // Cache actual reactions under the quantity-independent reaction key.
    // Cache identity/visual metadata; actual quantities are always recomputed
    // by the deterministic engine for the current input amounts.
    if (result?.reactionOccurred) {
      const quantityProfile = buildQuantityProfile(
        reactionCode,
        result?.chemicalEquation || '',
        allChemicals,
        result?.resultingChemicals || [],
        result?.gasVolumeMl,
        result?.reactionExtentMoles ?? result?.quantityCalculation?.reactionExtentMoles
      );
      if (quantityProfile) {
        result = { ...result, reactionCode, quantityProfile };
      } else {
        result = { ...result, reactionCode };
      }
      try {
        await setDoc(reactionDocRef, sanitizeFirestoreData(result));
      } catch (error) {
        console.error('Failed to save reaction cache', error);
      }
    }
    return Response.json({ ...result, reactionCode });
  } catch (error: any) {
    console.error('[Netlify /api/react]', error);
    return Response.json({ error: error?.message || 'Failed to simulate reaction' }, { status: 500 });
  }
}

async function handleGenerateChemical(body: any): Promise<Response> {
  try {
    const { description, apiKeys } = body || {};
    if (!Array.isArray(apiKeys) || apiKeys.length === 0) {
      return Response.json({ error: 'Gemini API key required. Add your API key in Settings.' }, { status: 400 });
    }
    const request = String(description || '').trim();
    if (!request) return Response.json({ error: 'Chemical description is required.' }, { status: 400 });

    const hash = crypto.createHash('sha256').update(JSON.stringify({ description: request.toLowerCase() })).digest('hex');
    const chemDocRef = doc(db, 'chemical_generation_cache', hash);
    const cachedDoc = await getDoc(chemDocRef);
    if (cachedDoc.exists()) return Response.json(cachedDoc.data());

    const prompt = `The user wants a new chemical for a virtual chemistry lab simulator.
User request: "${request}"
Generate a realistic chemical object matching this request.
It must include a realistic hex color for its default appearance.
For the state, choose 'solid', 'liquid', or 'gas'.
For the category, pick a fitting general category.`;

    const gemini = await callGemini(apiKeys, prompt, chemicalResponseSchema);
    if (!gemini.ok) return gemini.response;

    let result: any;
    try { result = JSON.parse(gemini.text); }
    catch { return Response.json({ error: 'Gemini returned invalid JSON for the structured synthesizer response.' }, { status: 502 }); }

    try { await setDoc(chemDocRef, sanitizeFirestoreData(result)); } catch (error) { console.error('Failed to save chemical cache', error); }
    return Response.json(result);
  } catch (error: any) {
    console.error('[Netlify /api/generate-chemical]', error);
    return Response.json({ error: error?.message || 'Failed to generate chemical' }, { status: 500 });
  }
}

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405 });
  }
  const pathname = new URL(request.url).pathname;
  let body: any;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'Invalid JSON request body.' }, { status: 400 }); }

  if (pathname === '/api/react') return handleReact(body);
  if (pathname === '/api/generate-chemical') return handleGenerateChemical(body);
  return Response.json({ error: `Unknown API route: ${pathname}` }, { status: 404 });
}

export const config = {
  path: ['/api/react', '/api/generate-chemical'],
  method: 'POST',
};
