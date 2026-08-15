
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';
import { buildQuantityProfile, buildReactionCachePayload, makeReactionCode } from './src/lib/reactionProfile';
import { calculateDeterministicQuantities } from './src/lib/stoichiometry';
import { sanitizeFirestoreData } from './src/lib/firestoreSafe';

dotenv.config();

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);


async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());


  app.post('/api/react', async (req, res) => {
    try {
      const { action, sourceChemicals, targetEquipment, targetChemicals, amount, apiKeys, temperature, pressure, reactionTime } = req.body;
      
      let keysToTry: string[] = [];
      if (Array.isArray(apiKeys) && apiKeys.length > 0) keysToTry.push(...apiKeys);
      if (keysToTry.length === 0) {
        return res.status(400).json({ error: 'Gemini API key required. Add your API key in Settings.' });
      }

      let allChemicals: any[] = [];
      if (Array.isArray(sourceChemicals)) allChemicals.push(...sourceChemicals);
      if (Array.isArray(targetChemicals)) allChemicals.push(...targetChemicals);

      const sourceLiquidVolumeMl = Number.isFinite(Number(req.body?.sourceLiquidVolumeMl))
        ? Math.max(0, Number(req.body.sourceLiquidVolumeMl))
        : 0;
      const targetLiquidVolumeMl = Number.isFinite(Number(req.body?.targetLiquidVolumeMl))
        ? Math.max(0, Number(req.body.targetLiquidVolumeMl))
        : 0;
      const inputLiquidVolumeMl =
        (sourceLiquidVolumeMl + targetLiquidVolumeMl) > 0
          ? sourceLiquidVolumeMl + targetLiquidVolumeMl
          : undefined;

      // Reaction identity deliberately excludes quantities. The same chemical
      // combination/conditions is one experiment; quantities are applied later
      // through the shared deterministic quantity engine.
      const payloadToHash = buildReactionCachePayload(req.body);
      const hash = crypto.createHash('sha256').update(JSON.stringify(payloadToHash)).digest('hex');
      const reactionCode = makeReactionCode(hash);
      const reactionDocRef = doc(db, 'reactions', hash);
      const cachedDoc = await getDoc(reactionDocRef);
      if (cachedDoc.exists()) {
        const cached = cachedDoc.data() as any;
        // Reuse identity / equation / visuals from cache, but ALWAYS recompute
        // quantities from current input amounts via the deterministic engine.
        // Never return stored absolute product amounts for a different pour volume.
        if (cached?.chemicalEquation) {
          const deterministic = calculateDeterministicQuantities(
            cached.chemicalEquation,
            allChemicals,
            cached.resultingChemicals || [],
            Number(temperature || 25),
            Number(pressure || 1),
            inputLiquidVolumeMl
          );
          if (deterministic) {
            console.log('Cache hit — recomputed stoichiometry for current quantities:', reactionCode);
            return res.json({
              ...cached,
              ...deterministic,
              gasVolumeMl: deterministic.gasProduced ? (deterministic.gasVolumeMl ?? 0) : 0,
              reactionCode: cached.reactionCode || reactionCode,
              cached: true,
            });
          }
        }
        // Fall through to Gemini if equation missing or stoichiometry cannot apply.
      }

      let prompt = `I am simulating a virtual chemistry lab.`;
      if (action === 'heat') {
        const hasContents = targetChemicals && targetChemicals.length > 0;
        // Empty burner/candle ignition is handled client-side (flame + heat only).
        // The reaction API is only called when there are actual chemicals to heat.
        prompt += `\nI am intensely heating a ${targetEquipment} which contains ${hasContents ? targetChemicals.map((c: any) => `${c.amount}${c.chemical?.state === 'solid' ? 'g' : 'ml'} of ${c.chemical.name}`).join(' and ') : 'nothing'}. The current temperature is ${temperature || 25}°C.
        Analyze the chemical reaction (e.g. decomposition, combustion, boiling) that occurs due to heating. If contents include combustible solids (Magnesium Ribbon, Coal, etc.) in contact with flame/heat, treat this as combustion in air and ALWAYS provide a chemicalEquation and visualEffect. If Magnesium Ribbon burns, ensure visualEffect includes 'white dazzling flame'. If Coal burns, ensure gasProduced is true and visualEffect reflects burning. If Hydrogen gas is present and ignited, set isPop to true.`;
      } else if (action === 'cool') {
        prompt += `\nI am cooling a ${targetEquipment} which contains ${targetChemicals && targetChemicals.length > 0 ? targetChemicals.map((c: any) => `${c.amount}ml of ${c.chemical.name}`).join(' and ') : 'nothing'} in an ice bath. The current temperature is ${temperature || 25}°C.
        Analyze the chemical or physical reaction (e.g. crystallization, freezing, precipitation, condensation) that occurs due to cooling.`;
      } else if (action === 'photolyze') {
        prompt += `\nI am exposing a ${targetEquipment} which contains ${targetChemicals && targetChemicals.length > 0 ? targetChemicals.map((c: any) => `${c.amount}ml of ${c.chemical.name}`).join(' and ') : 'nothing'} to intense UV sunlight / light.
        Analyze if any photolytic decomposition or photochemical reaction occurs.`;
      } else if (action === 'electrolyze') {
        prompt += `\nI am applying electricity (electrolysis) via electrodes to a ${targetEquipment} which contains ${targetChemicals && targetChemicals.length > 0 ? targetChemicals.map((c: any) => `${c.amount}ml of ${c.chemical.name}`).join(' and ') : 'nothing'}.
        Analyze if any electrolytic decomposition or electrochemical reaction occurs (consider if the solution conducts electricity).`;
      } else if (action === 'stir') {
        prompt += `\nI am vigorously stirring a ${targetEquipment} which contains ${targetChemicals && targetChemicals.length > 0 ? targetChemicals.map((c: any) => `${c.amount}ml of ${c.chemical.name}`).join(' and ') : 'nothing'}.
        Analyze if stirring causes any reaction (e.g. faster dissolving, mixing, color change).`;
      } else {
        prompt += `\nI poured ${amount}ml of a mixture containing ${sourceChemicals?.map((c: any) => `${c.amount}ml of ${c.chemical.name}`).join(' and ')} into a ${targetEquipment} which currently contains ${targetChemicals && targetChemicals.length > 0 ? targetChemicals.map((c: any) => `${c.amount}ml of ${c.chemical.name}`).join(' and ') : 'nothing'}.
        Analyze the chemical reaction that occurs upon mixing.`;
      }
      
      prompt += `
CRITICAL REQUIREMENTS FOR ACCURACY:
1. Base your answer on real-world chemistry and balanced chemical equations.
2. The user wants to see the outcome of this action after this time interval: ${reactionTime || 'end of reaction'}. Simulate the state at this time, with reaction rate ${req.body.reactionRate || 'normal'}. Short intervals or slow rate may mean partial completion.
3. Input amounts are in ml for liquids/solutions and grams for solids. Treat 1 ml aqueous ≈ 1 g for mass estimates only when concentration is unknown.
4. Identify the balanced chemical equation and products. DO NOT calculate or guess product quantities. The server calculates final quantities and stored reaction ratios deterministically. If an amount field is required by the schema, it may be omitted or set to 0 because it is not authoritative.
5. Temperature: estimate ΔT from reaction enthalpy if known; otherwise small sensible values. Room temp ≈ 25°C.
6. If no reaction occurs, state that they mix or nothing happens; keep resultingChemicals as the mixed contents with conserved amounts.
7. Explosions/vigorous reactions: note in visualEffect and set isExplosive if the vessel would shatter.
8. QUANTITY RULES:
   - resultingChemicals lists ONLY substances that remain INSIDE the container: liquids, dissolved species, solids/precipitates.
   - NEVER put gases (H2, O2, CO2, Cl2, NH3, SO2, etc.) in resultingChemicals. Represent gases only with gasProduced=true and gasColor.
   - Do not put gas molar volumes into resultingChemicals; the server calculates gas volume with PV=nRT.
   - Do not apply stoichiometric coefficients twice. Do not treat ml as moles or liters as ml.`;

      const responseSchema = {
          type: 'object',
          properties: {
              reactionOccurred: { type: 'boolean' },
              chemicalEquation: { type: 'string', description: "Balanced chemical equation if applicable, otherwise a brief explanation" },
              resultingChemicals: { 
                  type: 'array', 
                  items: { 
                      type: 'object', 
                      properties: {
                          name: { type: 'string' },
                          formula: { type: 'string' },
                          defaultColor: { type: 'string' },
                          category: { type: 'string' },
                          state: { type: 'string' },
                          amount: { type: 'number', description: "Optional advisory quantity only. Do not calculate this; the server determines the final quantity." }
                      },
                      required: ["name", "formula", "defaultColor", "category", "state", "amount"]
                  },
                  description: "List of resulting substances in the container"
              },
              visualEffect: { type: 'string', description: "Description of what it looks like (e.g. 'Bubbling vigorously', 'Turns pink', 'No visible change')" },
              liquidColor: { type: 'string', description: "Hex code for the color of the liquid in the container (e.g., #FFFFFF for clear, #FF0000 for red). Use #a0d8ef (light blue/transparent) for water/clear liquids." },
              isExplosive: { type: 'boolean', description: "True if the reaction is explosive or shatters the container" },
              isPop: { type: 'boolean', description: "True if the reaction involves hydrogen gas igniting with a characteristic pop sound" },
              gasProduced: { type: 'boolean', description: "True if gas or smoke is produced" },
              gasColor: { type: 'string', description: "Hex code for the color of the gas produced (e.g., #FFFFFF for white smoke, #808080 for gray, #FFFF00 for yellow-green Cl2). Empty string if no gas." },
              temperatureChange: { type: 'number', description: "Temperature change in Celsius (e.g. 5 for exothermic, -2 for endothermic, 0 if no change). Note: Room temperature is ~25C." },
              hasPrecipitate: { type: 'boolean', description: "True if a solid precipitate forms at the bottom of the container." },
              precipitateColor: { type: 'string', description: "Hex code for the color of the precipitate (if any). Empty string if none." }
          },
          required: ["reactionOccurred", "chemicalEquation", "resultingChemicals", "visualEffect", "liquidColor", "isExplosive", "isPop", "gasProduced", "gasColor", "temperatureChange", "hasPrecipitate", "precipitateColor"]
      };

      let responseText: string | null = null;
      let lastGeminiError: any = null;

      for (const rawKey of keysToTry) {
        const key = String(rawKey || '').trim().replace(/^['\"]|['\"]$/g, '');
        if (!key) continue;

        try {
          const geminiResponse = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': key,
              },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  responseMimeType: 'application/json',
                  responseSchema,
                  thinkingConfig: { thinkingLevel: 'minimal' },
                },
              }),
            }
          );

          const rawBody = await geminiResponse.text();
          let body: any = null;
          try { body = rawBody ? JSON.parse(rawBody) : null; } catch { /* handled below */ }

          if (!geminiResponse.ok) {
            const apiMessage = body?.error?.message || `Gemini returned HTTP ${geminiResponse.status}`;
            lastGeminiError = new Error(apiMessage);
            (lastGeminiError as any).status = geminiResponse.status;
            console.error(`[Gemini] HTTP ${geminiResponse.status}: ${apiMessage}`);
            // A user key can be invalid, restricted, expired, rate-limited, or
            // temporarily unavailable. Try the next user-supplied key before
            // giving up. No integrated/fallback key is ever used.
            continue;
          }

          const text = body?.candidates?.[0]?.content?.parts
            ?.map((part: any) => part?.text || '')
            .join('')
            .trim();

          if (!text) {
            lastGeminiError = new Error('Gemini returned an empty response.');
            continue;
          }

          responseText = text;
          break;
        } catch (err: any) {
          lastGeminiError = err;
          console.error('[Gemini] Request failed:', err?.message || err);
        }
      }

      if (!responseText) {
        const status = Number(lastGeminiError?.status || 0);
        const message = String(lastGeminiError?.message || 'Gemini request failed.');
        if (status === 401 || status === 403) {
          return res.status(status).json({
            error: `Gemini rejected the supplied API key: ${message}`
          });
        }
        if (status === 429) {
          return res.status(429).json({
            error: `Gemini rate limit/quota exceeded: ${message}`
          });
        }
        return res.status(502).json({
          error: `Gemini API request failed: ${message}`
        });
      }

      let result: any;
      try {
        result = JSON.parse(responseText);
      } catch {
        return res.status(502).json({ error: 'Gemini returned invalid JSON for the structured reaction response.' });
      }

      const deterministic = calculateDeterministicQuantities(
        result?.chemicalEquation || '',
        allChemicals,
        result?.resultingChemicals || [],
        Number(temperature || 25),
        Number(pressure || 1),
        inputLiquidVolumeMl
      );
      if (deterministic) result = { ...result, ...deterministic };

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
          // Still tag the reaction code even if we could not build a scalable
          // quantity profile (e.g. unparseable equation with no product amounts).
          result = { ...result, reactionCode };
        }
        try {
          await setDoc(reactionDocRef, sanitizeFirestoreData(result));
          console.log('Saved reaction to cache:', reactionCode, quantityProfile ? '(with profile)' : '(no profile)');
        } catch (e) {
          console.error('Failed to save reaction cache', e);
        }
      }
      res.json({ ...result, reactionCode });

    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Failed to simulate reaction' });
    }
  });


  app.post('/api/generate-chemical', async (req, res) => {
    try {
      const { description, apiKeys } = req.body;
      let keysToTry: string[] = [];
      if (Array.isArray(apiKeys) && apiKeys.length > 0) keysToTry.push(...apiKeys);
      if (keysToTry.length === 0) {
        return res.status(400).json({ error: 'Gemini API key required. Add your API key in Settings.' });
      }
      
      const payloadToHash = { description: description.toLowerCase().trim() };
      const hash = crypto.createHash('sha256').update(JSON.stringify(payloadToHash)).digest('hex');
      const chemDocRef = doc(db, 'chemical_generation_cache', hash);
      const cachedDoc = await getDoc(chemDocRef);
      if (cachedDoc.exists()) {
        console.log('Returning cached chemical:', hash);
        return res.json(cachedDoc.data());
      }
      
      let prompt = `The user wants a new chemical for a virtual chemistry lab simulator.
User request: "${description}"
Generate a realistic chemical object matching this request. 
It must include a realistic hex color for its default appearance (use #ffffff for clear/transparent liquids, or white powders).
For the state, choose 'solid', 'liquid', or 'gas'.
For the category, pick a fitting one like 'Acids', 'Bases', 'Solvents', 'Salt Solutions', 'Solids', 'Indicators', 'Other Reagents' or make up a general one.`;

      const responseSchema = {
          type: 'object',
          properties: {
              name: { type: 'string', description: "Name of the chemical" },
              formula: { type: 'string', description: "Chemical formula" },
              defaultColor: { type: 'string', description: "Hex code for the default color of the substance (e.g., #ffffff for white powders or clear liquids)" },
              category: { type: 'string', description: "Category name" },
              state: { type: 'string', description: "Physical state: 'solid', 'liquid', or 'gas'" }
          },
          required: ["name", "formula", "defaultColor", "category", "state"]
      };

      let responseText: string | null = null;
      let lastGeminiError: any = null;
      for (const rawKey of keysToTry) {
        const key = String(rawKey || '').trim().replace(/^['\"]|['\"]$/g, '');
        if (!key) continue;
        try {
          const geminiResponse = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': key,
              },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  responseMimeType: 'application/json',
                  responseSchema,
                  thinkingConfig: { thinkingLevel: 'minimal' },
                },
              }),
            }
          );
          const rawBody = await geminiResponse.text();
          let body: any = null;
          try { body = rawBody ? JSON.parse(rawBody) : null; } catch {}
          if (!geminiResponse.ok) {
            const apiMessage = body?.error?.message || `Gemini returned HTTP ${geminiResponse.status}`;
            lastGeminiError = new Error(apiMessage);
            (lastGeminiError as any).status = geminiResponse.status;
            continue;
          }
          responseText = body?.candidates?.[0]?.content?.parts
            ?.map((part: any) => part?.text || '')
            .join('')
            .trim() || null;
          if (responseText) break;
          lastGeminiError = new Error('Gemini returned an empty response.');
        } catch (err: any) {
          lastGeminiError = err;
        }
      }
      if (!responseText) {
        const status = Number(lastGeminiError?.status || 0);
        const message = String(lastGeminiError?.message || 'Gemini request failed.');
        if (status === 401 || status === 403) return res.status(status).json({ error: `Gemini rejected the supplied API key: ${message}` });
        if (status === 429) return res.status(429).json({ error: `Gemini rate limit/quota exceeded: ${message}` });
        return res.status(502).json({ error: `Gemini API request failed: ${message}` });
      }

      let result: any;
      try {
        result = JSON.parse(responseText);
      } catch {
        return res.status(502).json({ error: 'Gemini returned invalid JSON for the structured synthesizer response.' });
      }
      try {
        await setDoc(chemDocRef, sanitizeFirestoreData(result));
        console.log('Saved new chemical to cache:', hash);
      } catch (e) {
        console.error('Failed to save to cache', e);
      }
      res.json(result);

    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Failed to generate chemical' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
