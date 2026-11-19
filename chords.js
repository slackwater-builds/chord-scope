/* Chord naming engine — turns a set of MIDI notes into a jazz-style chord symbol.
   Works in the browser (window.Chords) and in Node (module.exports). */
(function (root) {
  'use strict';

  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const ACC = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##' };

  // letter steps above the root for each chord-tone label (used for spelling)
  const DEGREE_STEPS = {
    'R': 0, 'b9': 1, '9': 1, '2': 1, '#9': 1, 'b3': 2, '3': 2,
    '4': 3, '11': 3, '#11': 3, 'b5': 4, '5': 4, '#5': 4,
    'b13': 5, '13': 5, '6': 5, 'bb7': 5, 'b7': 6, '7': 6
  };

  // Keys: name -> { pcs spelled in that key (pc -> letter+acc), prefer: 'b' | '#' }
  const KEY_SIGS = {
    'C': 0, 'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5, 'F#': 6,
    'F': -1, 'Bb': -2, 'Eb': -3, 'Ab': -4, 'Db': -5, 'Gb': -6
  };
  const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

  function keyAccidentals(key) {
    const n = KEY_SIGS[key] || 0;
    const map = {};
    if (n > 0) SHARP_ORDER.slice(0, n).forEach(l => (map[l] = 1));
    if (n < 0) FLAT_ORDER.slice(0, -n).forEach(l => (map[l] = -1));
    return map;
  }

  // spell a pitch class as a note name given a key ('auto' behaves like C with flat bias)
  function spellPc(pc, key, prefer) {
    const km = keyAccidentals(key === 'auto' ? 'C' : key);
    // diatonic in key?
    for (const L of LETTERS) {
      if ((LETTER_PC[L] + (km[L] || 0) + 12) % 12 === pc) return L + ACC[km[L] || 0];
    }
    const n = KEY_SIGS[key] || 0;
    const usesSharps = prefer ? prefer === '#' : n > 0;
    for (const L of LETTERS) {
      const a = usesSharps ? 1 : -1;
      if ((LETTER_PC[L] + a + 12) % 12 === pc) return L + ACC[a];
    }
    return LETTERS[0];
  }

  // default root spellings when key is auto/C, by chord family
  const ROOT_MAJ = { 0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F', 6: 'F#', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B' };
  const ROOT_MIN = { 0: 'C', 1: 'C#', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F', 6: 'F#', 7: 'G', 8: 'G#', 9: 'A', 10: 'Bb', 11: 'B' };

  function rootSpelling(pc, family, key) {
    if (!key || key === 'auto' || key === 'C') {
      return (family === 'minor' ? ROOT_MIN : ROOT_MAJ)[pc];
    }
    return spellPc(pc, key);
  }

  function pcOfName(name) {
    let pc = LETTER_PC[name[0]];
    for (const ch of name.slice(1)) pc += ch === '#' ? 1 : ch === 'b' ? -1 : 0;
    return (pc + 120) % 12;
  }

  // Spell a midi note with a given letter -> {letter, acc, octave, name}
  function spellMidiWithLetter(midi, letter) {
    const pc = midi % 12;
    let acc = pc - LETTER_PC[letter];
    while (acc > 6) acc -= 12;
    while (acc < -6) acc += 12;
    const natMidi = midi - acc;
    const octave = Math.floor(natMidi / 12) - 1;
    return { letter, acc, octave, name: letter + ACC[acc] + octave, vex: letter.toLowerCase() + ACC[acc] + '/' + octave };
  }

  function spellMidiByName(midi, noteName) {
    return spellMidiWithLetter(midi, noteName[0]);
  }

  // ---------- interpretation of a pitch-class set relative to one root ----------
  function interpret(pcSet, rootPc, bassPc) {
    const has = i => pcSet.has((rootPc + i) % 12);
    const L = {}; // interval -> label
    const rootPresent = has(0);
    if (rootPresent) L[0] = 'R';

    let third = null, sus = null, seventh = null, fifth = null;
    let dim = false, halfdim = false, dim7 = false, aug = false;
    let penalty = 0;

    if (has(4)) { third = 'M'; L[4] = '3'; }
    else if (has(3)) { third = 'm'; L[3] = 'b3'; }
    if (!third) {
      if (has(5)) { sus = '4'; L[5] = '4'; }
      else if (has(2)) { sus = '2'; L[2] = '2'; }
    }
    if (has(10)) { seventh = 'b7'; L[10] = 'b7'; }
    if (has(11)) {
      if (seventh) { penalty += 4; L[11] = '7'; seventh = 'both'; }
      else { seventh = 'M7'; L[11] = '7'; }
    }
    if (has(7)) { fifth = 'P'; L[7] = '5'; }

    if (third === 'm' && has(6) && !has(7)) {
      dim = true; fifth = 'b'; L[6] = 'b5';
      if (seventh === 'b7') halfdim = true;
      else if (!seventh && has(9)) { dim7 = true; L[9] = 'bb7'; }
    }
    if (third === 'M' && has(8) && !has(7)) {
      // on an altered dominant (b9/#9 present) call it b13, otherwise #5 / augmented
      if (seventh === 'b7' && (has(1) || has(3))) L[8] = 'b13';
      else { aug = true; fifth = '#'; L[8] = '#5'; }
    }

    // remaining tones
    if (has(1)) L[1] = 'b9';
    if (has(2) && !L[2]) L[2] = '9';
    if (has(3) && !L[3]) L[3] = '#9';
    if (has(5) && !L[5]) L[5] = '11';
    if (has(6) && !L[6]) {
      if (fifth === 'P') L[6] = '#11';
      else if (third === 'M' && (seventh === 'M7' || has(2) || (seventh && has(9)))) L[6] = '#11';
      else { L[6] = 'b5'; if (!fifth) fifth = 'b'; }
    }
    if (has(8) && !L[8]) {
      if (fifth === 'P' || fifth === 'b') L[8] = 'b13';
      else { L[8] = '#5'; fifth = fifth || '#'; if (third === 'm') penalty += 2; }
    }
    if (has(9) && !L[9]) L[9] = seventh ? '13' : '6';

    const lab = new Set(Object.values(L));
    const t = x => lab.has(x);

    // ---- build quality string ----
    let q = '';
    const alts = [];
    const adds = [];
    let family = 'major';

    const pushAlts = list => list.forEach(a => { if (t(a)) alts.push(a); });

    if (dim7) {
      family = 'minor';
      q = 'dim7';
      if (t('9')) adds.push('add9');
      if (t('11')) adds.push('add11');
      if (t('b13')) adds.push('addb13');
      if (t('7')) adds.push('addmaj7');
      if (t('b9')) adds.push('addb9');
    } else if (halfdim) {
      family = 'minor';
      q = t('11') ? 'm11b5' : t('9') ? 'm9b5' : 'm7b5';
      pushAlts(['b9', 'b13']);
      if (t('13')) adds.push('add13');
    } else if (dim) {
      family = 'minor';
      q = 'dim';
      if (t('7')) q = 'dim(maj7)';
      if (t('9')) adds.push('add9');
      if (t('11')) adds.push('add11');
      if (t('b13')) adds.push('addb13');
      if (t('b9')) adds.push('addb9');
    } else if (third === 'M') {
      if (seventh === 'b7' || seventh === 'both') {
        q = t('13') ? '13' : t('9') ? '9' : '7';
        if (t('11')) { adds.push('add11'); penalty += 1.2; }
        pushAlts(['b5', '#5', 'b9', '#9', '#11', 'b13']);
        if (seventh === 'both') adds.push('addmaj7');
      } else if (seventh === 'M7') {
        q = t('13') ? 'maj13' : t('9') ? 'maj9' : 'maj7';
        if (t('11')) { adds.push('add11'); penalty += 1.2; }
        pushAlts(['b5', '#5', 'b9', '#9', '#11', 'b13']);
      } else {
        if (aug) q = '+';
        if (t('6') && t('9')) q += '6/9';
        else if (t('6')) q += '6';
        else if (t('9')) adds.push('add9');
        if (t('b5')) alts.push('b5');
        if (t('#11')) adds.push('add#11');
        if (t('11')) { adds.push('add11'); penalty += 0.8; }
        if (t('b9')) adds.push('addb9');
        if (t('#9')) adds.push('add#9');
        if (t('b13')) adds.push('addb13');
      }
    } else if (third === 'm') {
      family = 'minor';
      if (seventh === 'b7' || seventh === 'both') {
        q = t('13') ? 'm13' : t('11') ? 'm11' : t('9') ? 'm9' : 'm7';
        if (t('13') && t('11') && !t('9')) q = 'm13';
        pushAlts(['#5', 'b9', '#11', 'b13']);
        if (seventh === 'both') adds.push('addmaj7');
      } else if (seventh === 'M7') {
        q = t('13') ? 'm(maj13)' : t('11') ? 'm(maj11)' : t('9') ? 'm(maj9)' : 'm(maj7)';
        if (t('13') || t('11')) penalty += 1;
        pushAlts(['#5', 'b9', '#11', 'b13']);
      } else {
        q = 'm';
        if (t('6') && t('9')) q = 'm6/9';
        else if (t('6')) q = 'm6';
        else if (t('9')) adds.push('add9');
        if (t('11')) adds.push('add11');
        if (t('#5')) alts.push('#5');
        if (t('#11')) adds.push('add#11');
        if (t('b9')) adds.push('addb9');
        if (t('b13')) adds.push('addb6');
      }
    } else if (sus) {
      const s = 'sus' + sus;
      if (seventh === 'b7' || seventh === 'both') {
        const base = t('13') ? '13' : t('9') ? '9' : '7';
        q = base + s;
        if (sus === '2') penalty += 0.5;
        pushAlts(['b5', '#5', 'b9', '#9', '#11', 'b13']);
      } else if (seventh === 'M7') {
        q = (t('13') ? 'maj13' : t('9') ? 'maj9' : 'maj7') + s;
        pushAlts(['b5', '#5', 'b9', '#9', '#11', 'b13']);
      } else {
        q = (t('6') ? '6' : '') + s;
        if (t('6')) penalty += 1.5;
        if (sus === '4' && t('9')) adds.push('add9');
        pushAlts(['b5', '#5', 'b9', '#9', '#11', 'b13']);
      }
    } else {
      // no third, no sus
      if (seventh === 'b7') q = (t('13') ? '13' : t('9') ? '9' : '7') + '(no3)';
      else if (seventh === 'M7') q = (t('9') ? 'maj9' : 'maj7') + '(no3)';
      else if (fifth === 'P' && pcSet.size === 2) q = '5';
      else q = (t('6') ? '6' : '') + '(no3)';
      pushAlts(['b5', '#5', 'b9', '#9', '#11', 'b13']);
    }

    // ---- score ----
    let score = 0;
    score += rootPresent ? 6 : -4.5;
    if (bassPc === rootPc) score += 3;
    if (third) score += 2.5; else if (sus) score += 1; else score -= 3.5;
    if (fifth === 'P') score += 1; else if (dim) score += 0.5;
    if (seventh === 'b7' || seventh === 'M7') score += 1.5;
    if (dim7) score += 1;
    for (const a of lab) {
      if (a === '9') score -= 0.3;
      else if (a === '11') score -= 0.45;
      else if (a === '13' || a === '6') score -= 0.45;
      else if (['b9', '#9', '#11', 'b13'].includes(a)) score -= 0.8;
      else if (a === 'b5' && !dim) score -= 0.9;
      else if (a === '#5' && !aug) score -= 0.6;
    }
    score -= adds.length * 0.3;
    score -= penalty;
    // complete triads (root, 3rd, 5th, nothing else) are the most natural reading of 3 notes
    if (pcSet.size === 3 && rootPresent && third && fifth && Object.keys(L).length === 3) score += 2;
    if ((t('6')) && fifth !== 'P') score -= 0.8;
    if (!(third === 'M' && seventh === 'b7')) score -= alts.length * 0.7; // stacked alterations belong on dominants
    const clean = adds.length === 0 && (!!third || !!sus) && penalty === 0;

    const altered = (t('b9') || t('#9')) && (t('#5') || t('b13') || t('b5') || t('#11')) && (seventh === 'b7') && third === 'M';

    return {
      rootPc, rootPresent, labels: L, q, alts, adds, family, score,
      third, seventh, sus, altered, clean,
      hasThirdAndSeventh: !!third && (seventh === 'b7' || seventh === 'M7') || dim7
    };
  }

  // ---------- formatting ----------
  function qualityText(it, style) {
    let q = it.q;
    let alts = it.alts.slice();
    let adds = it.adds.slice();
    if (style === 'jazz') {
      q = q
        .replace(/^m7b5$/, 'ø7').replace(/^m9b5$/, 'ø9').replace(/^m11b5$/, 'ø11')
        .replace(/^dim7$/, '°7').replace(/^dim\(maj7\)$/, '°(Δ7)').replace(/^dim$/, '°')
        .replace(/^maj/, 'Δ').replace(/\(maj(\d+)\)/, '(Δ$1)')
        .replace(/^m(?=[\d(]|$)/, '–');
    }
    let s = q;
    const extra = alts.concat(adds);
    if (extra.length) {
      // put alterations inline, adds in parentheses
      s += alts.join('');
      if (adds.length) s += '(' + adds.join(',') + ')';
    }
    return s;
  }

  function prettyAcc(s) {
    return s.replace(/##/g, '𝄪').replace(/bb(?=\d|$|\/|\))/g, '𝄫').replace(/#/g, '♯').replace(/(?<=[A-G])b/g, '♭').replace(/b(?=\d)/g, '♭');
  }

  const LABEL_PRETTY = {
    'R': 'R', 'b9': '♭9', '9': '9', '2': '2', '#9': '♯9', 'b3': '♭3', '3': '3',
    '4': '4', '11': '11', '#11': '♯11', 'b5': '♭5', '5': '5', '#5': '♯5',
    'b13': '♭13', '13': '13', '6': '6', 'bb7': '°7', 'b7': '♭7', '7': '7'
  };

  const INTERVAL_NAMES = ['unison', 'minor 2nd', 'major 2nd', 'minor 3rd', 'major 3rd', 'perfect 4th', 'tritone', 'perfect 5th', 'minor 6th', 'major 6th', 'minor 7th', 'major 7th'];

  // ---------- main entry ----------
  // midis: array of MIDI numbers currently sounding
  // opts: { key: 'auto'|'C'|..., style: 'text'|'jazz' }
  function identify(midis, opts) {
    opts = opts || {};
    const key = opts.key || 'auto';
    const style = opts.style || 'text';
    const notes = Array.from(new Set(midis)).sort((a, b) => a - b);
    if (!notes.length) return null;
    const pcs = new Set(notes.map(m => m % 12));
    const bassMidi = notes[0];
    const bassPc = bassMidi % 12;

    // single note
    if (pcs.size === 1) {
      const nm = rootSpelling(bassPc, 'major', key);
      return {
        kind: 'note', name: prettyAcc(nm), text: nm, sub: notes.length > 1 ? 'octaves' : 'single note',
        rootPc: bassPc, rootName: nm, quality: '', bassName: null,
        tones: notes.map(m => ({ midi: m, ...spellMidiByName(m, nm), label: 'R' })),
        alternates: []
      };
    }

    // interpret every root
    const cands = [];
    for (let r = 0; r < 12; r++) {
      const it = interpret(pcs, r, bassPc);
      if (!it.rootPresent && !it.hasThirdAndSeventh) continue;
      cands.push(it);
    }
    cands.sort((a, b) => b.score - a.score);

    // two-note sets: show as interval unless it's a clear shell (root+3, root+7) or power chord
    if (pcs.size === 2) {
      const other = [...pcs].find(p => p !== bassPc);
      const iv = (other - bassPc + 12) % 12;
      const bn = rootSpelling(bassPc, iv === 3 || iv === 10 ? 'minor' : 'major', key);
      const top = notes[notes.length - 1];
      let label = null, name = null;
      if (iv === 7) { name = bn + '5'; }
      const topName = (() => {
        const steps = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6][iv];
        const letter = LETTERS[(LETTERS.indexOf(bn[0]) + steps) % 7];
        const sp = spellMidiWithLetter(top, letter);
        if (Math.abs(sp.acc) > 1) return spellPc(other, key);
        return letter + ACC[sp.acc];
      })();
      return {
        kind: 'interval',
        name: prettyAcc(name || (bn + ' – ' + topName)),
        text: name || (bn + '-' + topName),
        sub: INTERVAL_NAMES[iv] + (iv === 7 ? ' (power chord)' : ''),
        rootPc: bassPc, rootName: bn, quality: '', bassName: null,
        tones: notes.map(m => {
          const isBass = m % 12 === bassPc;
          const sp = isBass ? spellMidiByName(m, bn) : spellMidiByName(m, topName);
          return { midi: m, ...sp, label: isBass ? 'R' : ['R', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'][iv] };
        }),
        alternates: []
      };
    }

    let best = cands[0];
    // Prefer a rootless reading when the best rooted reading has neither 3rd nor sus
    if (best && !best.third && (!best.sus || best.alts.length)) {
      const rl = cands.find(c => !c.rootPresent && c.hasThirdAndSeventh);
      if (rl) best = rl;
    }
    if (!best) return null;

    const build = it => {
      const rn = rootSpelling(it.rootPc, it.family, key);
      const qt = qualityText(it, style);
      let bassName = null;
      if (bassPc !== it.rootPc) {
        // spell bass by its function in the chord if it's a chord tone
        const iv = (bassPc - it.rootPc + 12) % 12;
        const lab = it.labels[iv];
        if (lab) {
          const letter = LETTERS[(LETTERS.indexOf(rn[0]) + DEGREE_STEPS[lab]) % 7];
          const sp = spellMidiWithLetter(bassMidi, letter);
          bassName = Math.abs(sp.acc) > 1 ? spellPc(bassPc, key) : letter + ACC[sp.acc];
        } else bassName = spellPc(bassPc, key);
      }
      const text = rn + qt + (bassName && it.rootPresent ? '/' + bassName : '');
      const tones = notes.map(m => {
        const iv = ((m % 12) - it.rootPc + 12) % 12;
        const lab = it.labels[iv] || '?';
        const letter = LETTERS[(LETTERS.indexOf(rn[0]) + (DEGREE_STEPS[lab] || 0)) % 7];
        let sp = spellMidiWithLetter(m, letter);
        if (Math.abs(sp.acc) > 1 || lab === '?') sp = spellMidiByName(m, spellPc(m % 12, key, it.family === 'minor' ? null : 'b'));
        return { midi: m, ...sp, label: lab, pretty: LABEL_PRETTY[lab] || lab };
      });
      return {
        kind: 'chord', rootPc: it.rootPc, rootName: rn, quality: qt, bassName: it.rootPresent ? bassName : null,
        rootless: !it.rootPresent,
        text: text + (it.rootPresent ? '' : ''),
        name: prettyAcc(rn) + prettyAcc(qt) + (bassName && it.rootPresent ? '/' + prettyAcc(bassName) : ''),
        sub: (!it.rootPresent ? 'rootless voicing' : '') + (it.altered ? (it.rootPresent ? '' : ' · ') + 'altered dominant (' + prettyAcc(rn) + '7alt)' : ''),
        score: it.score, tones
      };
    };

    const primary = build(best);
    const seen = new Set([primary.text]);
    const alternates = [];
    for (const c of cands) {
      if (c === best || !c.rootPresent || !c.clean) continue;
      if (c.score < best.score - 3) break;
      const b = build(c);
      if (seen.has(b.text)) continue;
      seen.add(b.text);
      alternates.push(b.name);
      if (alternates.length >= 2) break;
    }
    // the best rootless reading (handy for left-hand voicings)
    const rl = cands.find(c => !c.rootPresent && c.hasThirdAndSeventh && c.clean && c.alts.length <= 1 && c !== best);
    if (rl && best.rootPresent && pcs.size >= 4) {
      const b = build(rl);
      if (!seen.has(b.text)) alternates.push(b.name + ' (no root)');
    }
    primary.alternates = alternates;
    return primary;
  }

  // spell arbitrary notes (no chord) for the staff
  function spellNotes(midis, key) {
    return midis.map(m => ({ midi: m, ...spellMidiByName(m, spellPc(m % 12, key)) }));
  }

  const api = { identify, spellNotes, spellPc, prettyAcc, KEY_SIGS, keyAccidentals, pcOfName, INTERVAL_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Chords = api;
})(typeof self !== 'undefined' ? self : this);
