// First-aid steps for the emergencies a parent is most likely to face, written
// for a lay rescuer and tailored to the child's age. The technique for CPR and
// choking changes at the first birthday (American Heart Association / Red Cross
// "infant" vs "child"), so that is the line the guides are split on; a handful
// of steps (fever, falls, seizures) also tighten further inside the first year.
//
// This is first aid, not diagnosis: every guide opens with when to call 911, and
// nothing here names a medicine or a dose.

export type EmergencyAgeGroup = 'infant' | 'child';

export interface EmergencyGuide {
  /** When to call 911 for this one — read first, so it comes first. */
  callWhen: string[];
  id: string;
  /** Anything worth knowing that is not itself a step. */
  notes?: string[];
  /** Numbered, in the order to do them. */
  steps: string[];
  title: string;
  /** One line that says what this looks like, so the right card is picked. */
  when: string;
}

/** CPR and choking technique changes at one year; that is the AHA's infant line. */
export const INFANT_MAX_DAYS = 365;

/** A fever in a baby this young is always a call to the doctor straight away. */
export const YOUNG_INFANT_FEVER_DAYS = 90;

/**
 * The group to open on. Before a birth is logged there is no age to read, and
 * the guides a parent-to-be needs to rehearse are the infant ones.
 */
export function getEmergencyAgeGroup(ageDays: number | null): EmergencyAgeGroup {
  return ageDays == null || ageDays < INFANT_MAX_DAYS ? 'infant' : 'child';
}

function cpr(group: EmergencyAgeGroup): EmergencyGuide {
  if (group === 'infant') {
    return {
      callWhen: ['They do not respond, and are not breathing or are only gasping.'],
      id: 'cpr',
      notes: [
        "Don't stop to feel for a pulse — if they aren't breathing normally, push.",
        "A baby's heart usually stops because their breathing did, so the breaths matter. If you can't give them, keep pushing anyway.",
        'An AED can be used on a baby. Use child pads if the AED has them; adult pads if not (one on the chest, one on the back).'
      ],
      steps: [
        'Tap the sole of the foot and shout their name. No response and not breathing normally? Start now.',
        'Shout for help. Anyone there calls 911 and fetches an AED. Alone with a phone: put 911 on speaker and start. Alone without one: do 2 minutes of CPR first, then carry the baby with you to call.',
        'Lay the baby on their back on something firm and flat — a table or the floor.',
        'Push in the center of the chest, just below the nipple line: both thumbs with your hands wrapped around the chest, or the heel of one hand. About 1½ inches (4 cm) deep, 100–120 a minute — the beat of "Stayin\' Alive". Let the chest come all the way back up.',
        'After 30 pushes, give 2 breaths: tilt the head back just slightly, lift the chin, and cover their mouth and nose with your mouth. Puff gently — just enough to see the chest rise — about one second each.',
        'Keep going, 30 pushes then 2 breaths, until they breathe, help takes over, or an AED is ready. Turn the AED on and do what it says.'
      ],
      title: 'Not breathing / no heartbeat',
      when: 'Limp, not responding, and not breathing — or only gasping.'
    };
  }

  return {
    callWhen: ['They do not respond, and are not breathing or are only gasping.'],
    id: 'cpr',
    notes: [
      "Don't stop to feel for a pulse — if they aren't breathing normally, push.",
      "A child's heart usually stops because their breathing did, so the breaths matter. If you can't give them, keep pushing anyway.",
      'Use an AED as soon as one arrives. Child pads if it has them; adult pads if not, as long as they do not touch.',
      'Once puberty has started, use adult technique: two hands, at least 2 inches deep.'
    ],
    steps: [
      'Tap their shoulder and shout their name. No response and not breathing normally? Start now.',
      'Shout for help. Anyone there calls 911 and fetches an AED. Alone with a phone: put 911 on speaker and start. Alone without one: do 2 minutes of CPR first, then go and call.',
      'Lay them on their back on something firm and flat.',
      'Push in the center of the chest, on the lower half of the breastbone, with the heel of one hand (two hands for a bigger child). About 2 inches (5 cm) deep, 100–120 a minute — the beat of "Stayin\' Alive". Let the chest come all the way back up.',
      'After 30 pushes, give 2 breaths: tilt the head back, lift the chin, pinch the nose and seal your mouth over theirs. Breathe just enough to see the chest rise — about one second each.',
      'Keep going, 30 pushes then 2 breaths, until they breathe, help takes over, or an AED is ready. Turn the AED on and do what it says.'
    ],
    title: 'Not breathing / no heartbeat',
    when: 'Limp, not responding, and not breathing — or only gasping.'
  };
}

function choking(group: EmergencyAgeGroup): EmergencyGuide {
  if (group === 'infant') {
    return {
      callWhen: ["They can't cry, cough, or breathe — have someone call while you start."],
      id: 'choking',
      notes: [
        'No abdominal thrusts (Heimlich) under one year — back blows and chest thrusts only.',
        'Never sweep a finger blindly in their mouth; it can push the object further down.',
        'Even once it comes out, have the baby checked by a doctor.'
      ],
      steps: [
        'Coughing hard, gagging or crying? Let them cough — that is the body clearing it. Stay with them and watch.',
        'Silent, turning blue, or making a high-pitched noise? Act now.',
        '5 back blows: lay the baby face-down along your forearm, head lower than their chest, holding the jaw (not the throat). Give 5 firm blows between the shoulder blades with the heel of your hand.',
        '5 chest thrusts: turn them face-up on your other forearm, head still low. With the heel of one hand in the center of the chest, just below the nipple line, give 5 quick pushes about 1½ inches deep.',
        'Repeat 5 back blows and 5 chest thrusts until the object comes out or the baby can cry or breathe.',
        'If they go limp, call 911 and start CPR. Each time you open the mouth for breaths, look — take the object out only if you can see it.'
      ],
      title: 'Choking',
      when: "Can't cry, cough, or breathe after putting something in their mouth."
    };
  }

  return {
    callWhen: ["They can't speak, cough, or breathe — have someone call while you start."],
    id: 'choking',
    notes: [
      'Never sweep a finger blindly in their mouth; it can push the object further down.',
      'After abdominal thrusts, have them checked by a doctor even if they seem fine.'
    ],
    steps: [
      'Coughing hard or able to talk? Encourage them to keep coughing, and stay with them.',
      "Can't speak, cough, or breathe, or clutching their throat? Tell them you're going to help.",
      '5 back blows: kneel or stand behind them, lean them forward with one arm across their chest, and give 5 firm blows between the shoulder blades with the heel of your hand.',
      '5 abdominal thrusts: wrap your arms around their waist, make a fist just above the belly button (well below the breastbone), grab it with your other hand, and give 5 quick thrusts in and up.',
      'Repeat 5 back blows and 5 abdominal thrusts until the object comes out or they can breathe, cough, or talk.',
      'If they go limp, lower them to the floor, call 911 and start CPR. Each time you open the mouth for breaths, look — take the object out only if you can see it.'
    ],
    title: 'Choking',
    when: "Can't speak, cough, or breathe after putting something in their mouth."
  };
}

function breathing(group: EmergencyAgeGroup): EmergencyGuide {
  return {
    callWhen: [
      'Lips, tongue or face look blue or gray.',
      'Pauses in breathing, or breathing so hard they cannot ' + (group === 'infant' ? 'feed.' : 'talk or drink.'),
      'The skin between the ribs or at the base of the neck sucks in with each breath, or they grunt with every breath.',
      'Unusually sleepy, floppy, or hard to wake.'
    ],
    id: 'breathing',
    steps: [
      'Call 911 if any of the signs above are there. Otherwise call the pediatrician now.',
      group === 'infant'
        ? 'Hold the baby upright against you, or let them find the position they breathe easiest in.'
        : 'Let them sit up in whatever position they breathe easiest in; keep them calm.',
      'Give nothing to eat or drink.',
      'Use any rescue inhaler or nebulizer exactly as their doctor prescribed it.',
      'If they stop breathing or go limp, start CPR.'
    ],
    title: 'Struggling to breathe',
    when: 'Working hard to breathe, wheezing, grunting, or turning blue.'
  };
}

function seizure(group: EmergencyAgeGroup): EmergencyGuide {
  return {
    callWhen: [
      ...(group === 'infant' ? ['Any seizure in a baby under one year.'] : ['It is their first seizure.']),
      'It lasts more than 5 minutes, or one follows another.',
      'They are blue or struggling to breathe afterwards, or do not start waking up.',
      'They were hurt, or it happened in water.'
    ],
    id: 'seizure',
    notes: ['A short seizure with a fever is common between 6 months and 5 years. It is still frightening, and still needs a doctor the same day.'],
    steps: [
      'Note the time it started.',
      'Lay them on their side on the floor, or another flat surface they cannot fall from. Move hard or sharp things away.',
      'Put nothing in their mouth — not a finger, not a spoon. They cannot swallow their tongue.',
      'Do not hold them down or try to stop the movements. Loosen anything tight around the neck.',
      'When it stops, keep them on their side and let them rest. Stay with them until they are fully awake.'
    ],
    title: 'Seizure',
    when: 'Stiffening, jerking or twitching, eyes rolled back, not responding.'
  };
}

function fever(ageDays: number | null): EmergencyGuide {
  const youngInfant = ageDays == null || ageDays < YOUNG_INFANT_FEVER_DAYS;
  return {
    callWhen: [
      'Hard to wake, limp, or unusually floppy.',
      'Struggling to breathe, or lips look blue.',
      'A seizure.',
      'A rash of spots that do not fade when you press a glass against them.'
    ],
    id: 'fever',
    notes: youngInfant
      ? ['Under 3 months, a rectal temperature of 100.4°F (38°C) or higher is always a call to the doctor straight away — even if the baby seems well.']
      : undefined,
    steps: youngInfant
      ? [
          'Take a rectal temperature — it is the reliable reading at this age.',
          '100.4°F (38°C) or higher: call the pediatrician now, day or night. If you cannot reach them, go to the emergency room.',
          'Do not give any fever medicine before a doctor has seen or spoken to the baby.',
          'Keep them lightly dressed and keep offering feeds.'
        ]
      : [
          'Call 911 for any of the signs above.',
          "Otherwise, call the pediatrician for advice — sooner if they won't drink, have far fewer wet diapers than usual, or just seem very unwell to you.",
          'Keep them lightly dressed, and keep offering fluids.',
          'Ask the pediatrician or pharmacist before giving any medicine; never give aspirin to a child.'
        ],
    title: youngInfant ? 'Fever under 3 months' : 'High fever',
    when: youngInfant ? '100.4°F (38°C) or higher in a baby under 3 months.' : 'A high temperature with other worrying signs.'
  };
}

function poisoning(): EmergencyGuide {
  return {
    callWhen: ['Not responding, struggling to breathe, or having a seizure.'],
    id: 'poisoning',
    notes: ['Poison Control is free, confidential, and open 24/7 — call even if you are only unsure.'],
    steps: [
      'Call Poison Control (1-800-222-1222) right away, even if they seem fine. Have the container in your hand.',
      'Swallowed a button battery or a magnet? Go to the emergency room now — even with no symptoms.',
      'Do not make them vomit, and give nothing to eat or drink unless Poison Control says to.',
      'On the skin: take off the clothing and rinse the skin under running water for 15–20 minutes.',
      'In the eyes: rinse with lukewarm running water for 15 minutes, holding the eyelids open.',
      'Take the container or plant with you if you go to the hospital.'
    ],
    title: 'Poisoning',
    when: 'Swallowed medicine, a cleaning product, a battery, a plant — or you think they might have.'
  };
}

function drowning(): EmergencyGuide {
  return {
    callWhen: ['Always — call 911 for any child pulled from the water who is not completely well.'],
    id: 'drowning',
    notes: ['Breathing trouble can start hours afterwards. Any coughing, fast breathing or unusual sleepiness later that day means calling the doctor.'],
    steps: [
      'Get them out of the water and shout for help.',
      'Not breathing normally? Start CPR straight away, with the breaths — they matter most here.',
      'Breathing? Lay them on their side so water can drain, and keep them warm.',
      'Have them checked by a doctor, even if they seem to recover fully.'
    ],
    title: 'Drowning',
    when: 'Found in the water, in any amount — a bath is enough.'
  };
}

function headInjury(group: EmergencyAgeGroup): EmergencyGuide {
  return {
    callWhen: [
      'Knocked out, even briefly, or now hard to wake.',
      'A seizure, or vomiting more than once.',
      'Clear fluid or blood coming from the nose or ears.',
      'Neck pain, or not moving an arm or leg normally — and then do not move them.',
      ...(group === 'infant' ? ['A soft bulge on the head, or the soft spot looks swollen.'] : [])
    ],
    id: 'head',
    steps: [
      'If you think the neck is hurt, keep them still and call 911 — do not pick them up.',
      'Otherwise, comfort them and hold a cold cloth on any bump for 20 minutes.',
      group === 'infant'
        ? 'Call the pediatrician after any fall in a baby under one year, even if they seem fine.'
        : 'Call the pediatrician if they were dazed, cry for a long time, or anything seems off.',
      'Watch them closely for the next 24 hours: sleepiness, vomiting, unsteadiness, or not acting like themselves means calling the doctor.'
    ],
    title: 'Fall / head injury',
    when: 'A fall or knock to the head.'
  };
}

function burns(group: EmergencyAgeGroup): EmergencyGuide {
  return {
    callWhen: [
      'A burn on the face, hands, feet, genitals or across a joint.',
      group === 'infant' ? 'Any burn bigger than a quarter, or any blistering burn.' : 'A burn bigger than their palm, or a deep, white or charred one.',
      'An electrical or chemical burn.'
    ],
    id: 'burns',
    steps: [
      'Hold the burn under cool (not cold) running water for 20 minutes.',
      'Take off clothing and jewelry near the burn — but not anything stuck to it.',
      'Cover it loosely with plastic wrap or a clean, non-fluffy cloth.',
      'No ice, butter, or creams.',
      group === 'infant'
        ? 'Keep the rest of the baby warm — babies get cold quickly while a burn is cooling.'
        : 'Keep the rest of them warm while the burn cools.'
    ],
    title: 'Burns',
    when: 'Hot drinks, bath water, stoves, irons, sun, or chemicals.'
  };
}

function bleeding(): EmergencyGuide {
  return {
    callWhen: ['Blood is spurting, soaking through, or will not stop after 10 minutes of firm pressure.'],
    id: 'bleeding',
    steps: [
      'Press firmly on the wound with a clean cloth or gauze.',
      "Don't lift it to look. If blood soaks through, add more on top and keep pressing.",
      'Keep pressing for 10 minutes without letting go.',
      'Have a doctor look at any cut that gapes, is on the face, or was made by something dirty or an animal bite.'
    ],
    title: 'Bleeding',
    when: 'A cut or wound that is bleeding heavily.'
  };
}

function allergicReaction(): EmergencyGuide {
  return {
    callWhen: [
      'Trouble breathing, wheezing, or a hoarse cry or voice.',
      'Swelling of the lips, tongue or face.',
      'Repeated vomiting, or turning pale and floppy, after a new food or a sting.'
    ],
    id: 'allergy',
    steps: [
      'If they have a prescribed epinephrine auto-injector, use it now — then call 911.',
      'Lay them down with their legs raised; if breathing is hard, let them sit up instead. Do not let them stand or walk.',
      'Stay with them. If they stop breathing, start CPR.',
      'Hives on their own, with none of the signs above: call the pediatrician.'
    ],
    title: 'Severe allergic reaction',
    when: 'Hives with swelling, breathing trouble or vomiting after a food, medicine or sting.'
  };
}

/**
 * Every guide for one age, most life-threatening first. A fever in a baby under
 * three months moves up beside the breathing card, since at that age it is a
 * same-hour call rather than a wait-and-see.
 */
export function getEmergencyGuides(group: EmergencyAgeGroup, ageDays: number | null): EmergencyGuide[] {
  // The group can be switched away from the child's own age. The fever card then
  // follows the group: switched to "under 1", it reads as the youngest baby the
  // group covers (and says so in its title) rather than as the child's real age.
  const groupAge = group === 'infant'
    ? ageDays != null && ageDays < INFANT_MAX_DAYS ? ageDays : null
    : Math.max(ageDays ?? 0, INFANT_MAX_DAYS);
  const feverGuide = fever(groupAge);
  const urgentFever = groupAge == null || groupAge < YOUNG_INFANT_FEVER_DAYS;

  return [
    cpr(group),
    choking(group),
    breathing(group),
    ...(urgentFever ? [feverGuide] : []),
    seizure(group),
    poisoning(),
    drowning(),
    headInjury(group),
    burns(group),
    bleeding(),
    allergicReaction(),
    ...(urgentFever ? [] : [feverGuide])
  ];
}
