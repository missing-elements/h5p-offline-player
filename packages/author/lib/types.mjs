import { randomUUID } from 'node:crypto'

/**
 * What a content type needs beyond its semantics. H5P's editor has a widget of its own for some
 * types — a slide to place elements on, a video to drag interactions over, a map of stages — and
 * those widgets set fields the form hides. Here each such type has its layout, run on the
 * generated parameters wherever that type appears, top level or as sub-content:
 *
 * - `before` adjusts the written parameters before generation;
 * - `after` sets the hidden fields on the generated ones, once the media are resolved, and checks
 *   what the editor's widget would not have let an author save;
 * - `sets` names the hidden fields the layout sets, which the schema leaves out;
 * - `optional` names fields the semantics call required that the content plays without, and the
 *   editor never asks for.
 *
 * Paths in `sets` and `optional` are dotted, `[]` for a list's item, relative to the type's own
 * parameters.
 *
 * The widgets followed are the newest release of the minor each content type in the pack names in
 * its `editorDependencies`: H5PEditor.InteractiveVideo 1.26.3 (h5p/h5p-editor-interactive-video at
 * 205abc173eece12046c4dedbe883ea5835e49151), H5PEditor.BranchingScenario 1.5.13
 * (h5p/h5p-editor-branching-scenario at 8fcd92d0a5a5f6b855d9d03ce4d19ab31baa4b99) and
 * H5PEditor.GameMap 1.2.5 (otacke/h5p-editor-game-map at a1ad6b04abb00ef0c1fda5bd446e4f95b8434873).
 * Course Presentation's and Find the Hotspot's layouts are this package's own and take nothing
 * from their editors. AGENTS.md says how to move them to a newer editor.
 */

/**
 * @typedef {{
 *   report: (path: string, message: string) => void,
 *   note: (path: string, message: string) => void,
 *   semantics: any[],
 *   library: any,
 *   title: (library: string) => string
 * }} LayoutContext
 * @typedef {{
 *   before?: (written: any, path: string, context: LayoutContext) => void,
 *   after?: (params: any, path: string, context: LayoutContext) => void,
 *   sets?: string[],
 *   optional?: string[]
 * }} Layout
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The machine name in a library string, `H5P.Image` for `H5P.Image 1.1`. @param {unknown} library */
const machineName = (library) => (typeof library === 'string' ? library.trim().split(/\s+/)[0] : '')

/** Text without its tags and entities, for measuring. @param {string} html */
function textOf(html) {
  return html.replace(/<[^<>]*>/g, ' ').replace(/&[a-zA-Z#0-9]+;/g, '_').replace(/\s+/g, ' ').trim()
}

/** A field's semantics, found by a path of names. @param {any[]} semantics @param {string[]} names */
function fieldAt(semantics, names) {
  let fields = semantics
  let field = null
  for (const name of names) {
    field = fields.find((each) => each.name === name)
    if (!field) return null
    if (field.type === 'list') fields = field.field?.type === 'group' ? field.field.fields ?? [] : [field.field]
    else fields = field.fields ?? []
  }
  return field
}

/* ---------------------------------------------------------------- Question Set */

/**
 * A question with no title is named as the set labels it itself, in the content's language: its
 * result screen lists each question by this title.
 * @type {Layout}
 */
const questionSet = {
  after(params, path, context) {
    const label = fieldAt(context.semantics, ['texts', 'questionLabel'])?.default ?? 'Question'
    ;(params.questions ?? []).forEach((/** @type {any} */ question, /** @type {number} */ i) => {
      if (isObject(question?.metadata) && question.metadata.title === undefined) question.metadata.title = `${label} ${i + 1}`
    })
  }
}

/* ---------------------------------------------------------------- Interactive Book */

/** A chapter is a page, and the book's table of contents names it by its title. @type {Layout} */
const interactiveBook = {
  after(params, path, context) {
    ;(params.chapters ?? []).forEach((/** @type {any} */ chapter, /** @type {number} */ i) => {
      if (isObject(chapter?.metadata) && chapter.metadata.title === undefined) {
        context.report(`${path}.chapters[${i}].metadata.title`, 'is required: the chapter\'s name in the table of contents')
      }
    })
  }
}

/* ---------------------------------------------------------------- Course Presentation */

/**
 * The slide Course Presentation draws, 16:9, and the text it draws on it at that size: 16 px on a
 * slide 640 px wide, about 8.5 px a character, 1.5 lines. Positions and sizes are percentages of
 * the slide's width (`x`, `width`) and height (`y`, `height`).
 */
const SLIDE = { width: 640, height: 360, font: 16, char: 8.5, line: 1.5 }
const MARGIN_X = 4
const MARGIN_Y = 5
const GAP = 2

/**
 * How many lines markup takes at 16 px in a width, at about 8.5 px a character: a heading's at
 * its size, and a little between blocks.
 * @param {string} html
 * @param {number} pixels
 */
function textLines(html, pixels) {
  let lines = 0
  const blocks = html.split(/<\/(?:p|div|li|h[1-6]|pre)>|<br\s*\/?>/i).filter((block) => textOf(block))
  for (const block of blocks.length ? blocks : [html]) {
    const scale = /<h[1-3]/i.test(block) ? 1.5 : 1
    const perLine = Math.max(8, Math.floor(pixels / (SLIDE.char * scale)))
    lines += Math.max(1, Math.ceil(textOf(block).length / perLine)) * scale + 0.4
  }
  return lines
}

/**
 * How much of a slide's height an element wants at a width: text by its lines, an image or a
 * video by its shape, anything interactive whatever is left.
 * @param {any} element
 * @param {number} width percent of the slide's width
 * @returns {{ height: number, flexible: boolean, min: number }}
 */
function wanted(element, width) {
  const library = machineName(element?.action?.library)
  const params = element?.action?.params ?? {}
  const pixels = (width / 100) * SLIDE.width
  if (library === 'H5P.AdvancedText') {
    const lines = textLines(String(params.text ?? ''), pixels)
    return { height: Math.min(95, (lines * SLIDE.font * SLIDE.line / SLIDE.height) * 100 + 3), flexible: false, min: 8 }
  }
  if (library === 'H5P.Image') {
    const file = params.file ?? {}
    const ratio = file.width && file.height ? file.height / file.width : 9 / 16
    return { height: width * (SLIDE.width / SLIDE.height) * ratio, flexible: false, min: 15 }
  }
  if (library === 'H5P.Video') return { height: width, flexible: false, min: 20 }
  if (library === 'H5P.Link') return { height: 9, flexible: false, min: 6 }
  if (library === 'H5P.Audio') return { height: 10, flexible: false, min: 8 }
  return { height: 0, flexible: true, min: element?.displayAsButton ? 12 : 40 }
}

/**
 * Elements without a position are stacked down the slide, full width, below any placed by hand.
 * Text keeps the height its lines need; a picture or a video shrinks, keeping its shape, to leave
 * a question the room it needs; a question takes what is left.
 * @param {any[]} elements
 * @param {string} path
 * @param {LayoutContext} context
 */
function stackSlide(elements, path, context) {
  const free = elements.filter((element) => typeof element?.x !== 'number' || typeof element?.y !== 'number')
  if (!free.length) return
  const placed = elements.filter((element) => !free.includes(element))
  const top = placed.length ? Math.max(...placed.map((element) => element.y + (element.height ?? 10))) + GAP : MARGIN_Y
  const width = 100 - 2 * MARGIN_X
  const kinds = free.map((element) => {
    if (element.displayAsButton) return { kind: 'button', height: 12, min: 12 }
    const library = machineName(element?.action?.library)
    const want = wanted(element, width)
    if (want.flexible) return { kind: 'flexible', height: 0, min: want.min }
    if (library === 'H5P.Image' || library === 'H5P.Video') return { kind: 'picture', height: want.height, min: Math.min(want.height, want.min) }
    return { kind: 'fixed', height: want.height, min: want.height }
  })
  const room = 100 - MARGIN_Y - top - GAP * (free.length - 1)
  const fixed = kinds.filter((each) => each.kind === 'fixed' || each.kind === 'button').reduce((sum, each) => sum + each.height, 0)
  const flexible = kinds.filter((each) => each.kind === 'flexible')
  const pictures = kinds.filter((each) => each.kind === 'picture')
  const needed = fixed + flexible.reduce((sum, each) => sum + each.min, 0) + pictures.reduce((sum, each) => sum + each.min, 0)
  if (needed > room + 0.5) {
    context.note(path, flexible.length
      ? 'likely holds more than fits on one slide: split it, or show the question as a button ("displayAsButton": true)'
      : 'likely holds more than fits on one slide: split it')
  }
  let rest = Math.max(0, room - fixed)
  // Pictures first get what they want, up to an equal share of what is left after the questions' minimum.
  const forPictures = Math.max(0, rest - flexible.reduce((sum, each) => sum + each.min, 0))
  for (const picture of pictures) picture.height = Math.max(picture.min, Math.min(picture.height, forPictures / pictures.length))
  rest -= pictures.reduce((sum, each) => sum + each.height, 0)
  for (const each of flexible) each.height = Math.max(each.min, rest / flexible.length)
  const scale = needed > room ? room / Math.max(1, kinds.reduce((sum, each) => sum + each.height, 0)) : 1
  let y = top
  free.forEach((element, i) => {
    const each = kinds[i]
    const height = Math.max(3, each.height * scale)
    let w = width
    let x = MARGIN_X
    if (each.kind === 'picture') {
      // A picture keeps its shape: narrower, centred, rather than squeezed.
      const full = wanted(element, width).height
      if (height < full) {
        w = width * (height / full)
        x = (100 - w) / 2
      }
    }
    if (each.kind === 'button') w = 10
    Object.assign(element, { x: round(x), y: round(y), width: round(w), height: round(height) })
    y += height + GAP
  })
}

/** @param {number} value */
function round(value) {
  return Math.round(value * 100) / 100
}

/** @type {Layout} */
const coursePresentation = {
  sets: ['presentation.slides[].elements[].x', 'presentation.slides[].elements[].y', 'presentation.slides[].elements[].width', 'presentation.slides[].elements[].height', 'presentation.ct'],
  after(params, path, context) {
    const slides = params?.presentation?.slides
    if (!Array.isArray(slides) || !slides.length) {
      context.report(`${path}.presentation.slides`, 'is required: write at least 1 slide')
      return
    }
    slides.forEach((/** @type {any} */ slide, /** @type {number} */ i) => {
      if (Array.isArray(slide?.elements)) stackSlide(slide.elements, `${path}.presentation.slides[${i}]`, context)
    })
  }
}

/* ---------------------------------------------------------------- Interactive Video */

/**
 * The video Interactive Video draws interactions over, in the units of their fields: `x` and `y`
 * in percent of the video, `width` and `height` in em, at 16 px to a video 640 px wide, so a
 * 16:9 video is 40 em wide and 22.5 em tall.
 */
const FRAME = { width: 40, height: 22.5 }

/** The room a button takes, in percent of the video, with some around it. */
const BUTTON = { width: 12, height: 12 }

/**
 * A poster's size where none is written. H5P's editor starts every interaction at 10 by 10 em
 * and leaves the rest to the author's mouse, but for a picture, which it gives the picture's own
 * shape, as is done here. A build has no mouse: a question gets room for its answers and buttons,
 * where 10 by 10 showed two answers of four and hid the Check button behind a scroll; a text as
 * much width as keeps it short. A link, a label and a hotspot keep the editor's size.
 * @param {any} interaction
 * @returns {{ width: number, height: number }}
 */
function posterSize(interaction) {
  const library = machineName(interaction?.action?.library)
  const params = interaction?.action?.params ?? {}
  if (library === 'H5P.Image') {
    const file = params.file ?? {}
    if (!(file.width > 0 && file.height > 0)) return { width: 10, height: 10 }
    // As the editor's setImageSize: no taller than the picture at 16 px an em, nor under one em.
    // And, which it does not check, no wider than the video less 2 em each side.
    const [width, height] = [Math.max(16, file.width), Math.max(16, file.height)]
    const tall = Math.min(10, height / 16)
    const wide = Math.min(FRAME.width - 4, tall * (width / height))
    return { width: round(wide), height: round(wide * (height / width)) }
  }
  if (library === 'H5P.Text') {
    for (const width of [12, 16, 20, 24]) {
      // Its lines, and an em of padding all round.
      const height = textLines(String(params.text ?? ''), (width - 2) * SLIDE.font) * SLIDE.line + 2
      if (height <= 12 || width === 24) return { width, height: round(Math.min(FRAME.height - 2, height)) }
    }
  }
  if (['H5P.Link', 'H5P.Nil', 'H5P.IVHotspot'].includes(library)) return { width: 10, height: 10 }
  // Two side by side, with a gap, within the margins.
  return { width: 17, height: 16 }
}

/**
 * Where a box nobody placed goes: down the left of the video, then the next column, a gap clear
 * of every box shown at the same time; `null` when the video has no room left.
 * @param {{ width: number, height: number }} box in percent of the video
 * @param {{ from: number, to: number }} time
 * @param {{ from: number, to: number, x: number, y: number, width: number, height: number }[]} shown
 */
function freeSpot(box, time, shown) {
  const together = shown.filter((other) => !(time.to < other.from || time.from > other.to))
  const clear = (/** @type {number} */ x, /** @type {number} */ y) => together.every((other) =>
    x + box.width + GAP <= other.x || other.x + other.width + GAP <= x || y + box.height + GAP <= other.y || other.y + other.height + GAP <= y)
  for (let x = 5; x === 5 || x + box.width <= 95; x += 5) {
    for (let y = 5; y === 5 || y + box.height <= 95; y += 5) if (clear(x, y)) return { x, y }
  }
  return null
}

/** @type {Layout} */
const interactiveVideo = {
  sets: [
    'interactiveVideo.assets.interactions[].x', 'interactiveVideo.assets.interactions[].y',
    'interactiveVideo.assets.interactions[].width', 'interactiveVideo.assets.interactions[].height',
    'interactiveVideo.assets.interactions[].libraryTitle'
  ],
  after(params, path, context) {
    const interactions = params?.interactiveVideo?.assets?.interactions
    if (!Array.isArray(interactions)) return
    /** @type {{ from: number, to: number, x: number, y: number, width: number, height: number }[]} */
    const shown = []
    interactions.forEach((/** @type {any} */ interaction, /** @type {number} */ i) => {
      if (!isObject(interaction)) return
      const at = `${path}.interactiveVideo.assets.interactions[${i}]`
      const from = typeof interaction.duration?.from === 'number' ? interaction.duration.from : 0
      const to = typeof interaction.duration?.to === 'number' ? interaction.duration.to : 0
      if (to < from) context.report(`${at}.duration`, `ends at ${to} s, before it starts at ${from} s`)
      if (interaction.action?.metadata && interaction.libraryTitle === undefined) interaction.libraryTitle = context.title(interaction.action.library)
      const poster = interaction.displayType === 'poster'
      if (poster) {
        const size = posterSize(interaction)
        if (typeof interaction.width !== 'number') interaction.width = size.width
        if (typeof interaction.height !== 'number') interaction.height = size.height
      }
      const box = poster ? { width: (interaction.width / FRAME.width) * 100, height: (interaction.height / FRAME.height) * 100 } : BUTTON
      if (typeof interaction.x !== 'number' || typeof interaction.y !== 'number') {
        const spot = freeSpot(box, { from, to }, shown)
        if (!spot) context.note(at, 'shows while the video has no room left for it, so it is placed over another: give it x and y, or show it at another time')
        Object.assign(interaction, spot ?? { x: 5, y: 5 })
      }
      shown.push({ from, to, x: interaction.x, y: interaction.y, ...box })
    })
  }
}

/* ---------------------------------------------------------------- Branching Scenario */

/**
 * The scenario as a graph: each node goes to the node `nextContentId` names, by its index in
 * `content`, a Branching Question to one per alternative, and a negative id ends the scenario
 * there, on the end screen with that `contentId`. Every node has to be reachable from the first,
 * and every path has to reach an end, or a learner is stuck.
 *
 * Where this departs from the editor: it gives a node with no next -1, an end, where here a source
 * has to say, a link left out being likelier a slip than an ending; and it makes one end screen,
 * -1, where the ones a source writes after it are numbered -2, -3… here, which the runtime finds by
 * `contentId` as it finds the first.
 * @type {Layout}
 */
const branchingScenario = {
  sets: ['branchingScenario.endScreens[].contentId'],
  after(params, path, context) {
    const scenario = params?.branchingScenario
    const content = scenario?.content
    if (!Array.isArray(content)) return
    const at = `${path}.branchingScenario`
    const endScreens = Array.isArray(scenario.endScreens) ? scenario.endScreens : []
    endScreens.forEach((/** @type {any} */ screen, /** @type {number} */ i) => {
      if (typeof screen.contentId !== 'number') screen.contentId = -(i + 1)
    })
    const ends = new Set([-1, ...endScreens.map((/** @type {any} */ screen) => screen.contentId)])
    /** @type {number[][]} */
    const next = content.map((/** @type {any} */ node, /** @type {number} */ i) => {
      const nodeAt = `${at}.content[${i}]`
      if (machineName(node?.type?.library) === 'H5P.BranchingQuestion') {
        // A question goes where its alternatives say. Its own next, which the editor deletes from a
        // question, is -1 here: the field is hidden and required, and would be reported unset.
        if (node.nextContentId === undefined) node.nextContentId = -1
        const alternatives = node?.type?.params?.branchingQuestion?.alternatives ?? []
        return alternatives.map((/** @type {any} */ alternative, /** @type {number} */ j) => check(alternative?.nextContentId, `${nodeAt}.type.params.branchingQuestion.alternatives[${j}].nextContentId`))
      }
      if (node?.nextContentId === undefined) {
        context.report(`${nodeAt}.nextContentId`, `is required: the index in content of the node that follows, or -1 to end the scenario here`)
        // Taken as an end, so that the one missing link is not reported again as a loop.
        return [-1]
      }
      return [check(node.nextContentId, `${nodeAt}.nextContentId`)]
    })
    /** @param {unknown} id @param {string} where */
    function check(id, where) {
      if (typeof id !== 'number' || !Number.isInteger(id)) {
        context.report(where, 'expected the index of a node in content, or -1 to end')
        return -1
      }
      if (id >= content.length) context.report(where, `is ${id}, but content has ${content.length} node${content.length === 1 ? '' : 's'}, 0 to ${content.length - 1}`)
      else if (id < 0 && !ends.has(id)) context.report(where, `is ${id}, but no end screen has that contentId; -1 is the default end`)
      return id
    }
    // Reachable from the first node, and able to reach an end from every node reached.
    const reached = new Set([0])
    const queue = [0]
    while (queue.length) {
      const node = /** @type {number} */ (queue.shift())
      for (const target of next[node] ?? []) if (target >= 0 && target < content.length && !reached.has(target)) {
        reached.add(target)
        queue.push(target)
      }
    }
    content.forEach((/** @type {unknown} */ _, /** @type {number} */ i) => {
      if (!reached.has(i)) context.note(`${at}.content[${i}]`, 'is not reached from the first node, so no learner sees it')
    })
    const ending = new Set()
    let changed = true
    while (changed) {
      changed = false
      next.forEach((targets, i) => {
        if (!ending.has(i) && targets.some((target) => target < 0 || ending.has(target))) {
          ending.add(i)
          changed = true
        }
      })
    }
    for (const node of reached) if (!ending.has(node)) context.report(`${at}.content[${node}]`, 'leads only into a loop: no path from it reaches an end, so a learner there cannot finish')
  }
}

/* ---------------------------------------------------------------- Game Map */

/**
 * Stages on a map: each placed by `telemetry`, in percent of the map and kept as text, and joined
 * to its `neighbors`, which a source names by label or index and the map stores as indices, both
 * ways, as the editor's map widget keeps them. Each gets the id that widget gives it, a UUID, and a
 * `type`, `stage` or `special-stage`, which the widget keeps on its own element rather than in the
 * content and the runtime works out from `specialStageType` again: the field is hidden and
 * required, and would be reported unset.
 * @type {Layout}
 */
const gameMap = {
  sets: [
    'gamemapSteps.gamemap.elements[].id', 'gamemapSteps.gamemap.elements[].type',
    'gamemapSteps.gamemap.paths[].from', 'gamemapSteps.gamemap.paths[].to', 'gamemapSteps.gamemap.dummy',
    'gamemapSteps.gamemap.elements[].accessRestrictions.dummy', 'gamemapSteps.gamemap.elements[].contentsList[].dummy', 'visual.misc.dummy'
  ],
  optional: [
    'gamemapSteps.gamemap.elements[].specialStageType', 'gamemapSteps.gamemap.elements[].specialStageLinkURL',
    'gamemapSteps.gamemap.elements[].contentsList', 'gamemapSteps.gamemap.elements[].neighbors'
  ],
  before(written, path, context) {
    const elements = written?.gamemapSteps?.gamemap?.elements
    if (!Array.isArray(elements)) return
    const labels = elements.map((/** @type {any} */ element) => (typeof element?.label === 'string' ? element.label.trim() : ''))
    elements.forEach((/** @type {any} */ element, /** @type {number} */ i) => {
      if (!isObject(element)) return
      const at = `${path}.gamemapSteps.gamemap.elements[${i}]`
      // Positions are kept as text; a source writes numbers, percent of the map from the top left.
      const telemetry = isObject(element.telemetry) ? element.telemetry : {}
      const columns = Math.ceil(Math.sqrt(elements.length))
      const position = {
        x: telemetry.x ?? 10 + (i % columns) * (80 / Math.max(1, columns - 1 || 1)),
        y: telemetry.y ?? 15 + Math.floor(i / columns) * (65 / Math.max(1, Math.ceil(elements.length / columns) - 1 || 1)),
        width: telemetry.width ?? 6,
        height: telemetry.height ?? 10
      }
      for (const [key, value] of Object.entries(position)) {
        if (typeof value !== 'number' || value < 0 || value > 100) context.report(`${at}.telemetry.${key}`, 'expected a number from 0 to 100, percent of the map')
      }
      element.telemetry = Object.fromEntries(Object.entries(position).map(([key, value]) => [key, String(Math.round(Number(value) * 100) / 100)]))
      if (element.neighbors !== undefined) {
        if (!Array.isArray(element.neighbors)) {
          context.report(`${at}.neighbors`, 'expected a list of stages, by label or index')
          element.neighbors = []
          return
        }
        element.neighbors = element.neighbors.map((/** @type {unknown} */ neighbor, /** @type {number} */ j) => {
          const index = typeof neighbor === 'number' ? neighbor : labels.indexOf(String(neighbor).trim())
          if (!Number.isInteger(index) || index < 0 || index >= elements.length || index === i) {
            context.report(`${at}.neighbors[${j}]`, `${JSON.stringify(neighbor)} names no other stage; the stages are ${labels.map((label) => JSON.stringify(label)).join(', ')}`)
            return null
          }
          return String(index)
        }).filter((/** @type {unknown} */ each) => each !== null)
      }
    })
    // A connection goes both ways, as the editor draws it.
    elements.forEach((/** @type {any} */ element, /** @type {number} */ i) => {
      for (const neighbor of element?.neighbors ?? []) {
        const other = elements[Number(neighbor)]
        if (!isObject(other)) continue
        other.neighbors = Array.isArray(other.neighbors) ? other.neighbors : []
        if (!other.neighbors.includes(String(i))) other.neighbors.push(String(i))
      }
    })
  },
  after(params, path, context) {
    const gamemap = params?.gamemapSteps?.gamemap
    const elements = gamemap?.elements
    if (!Array.isArray(elements)) return
    if (!elements.some((/** @type {any} */ element) => element?.canBeStartStage)) context.report(`${path}.gamemapSteps.gamemap.elements`, 'has no stage a learner can start at: set "canBeStartStage": true on one')
    elements.forEach((/** @type {any} */ element, /** @type {number} */ i) => {
      const at = `${path}.gamemapSteps.gamemap.elements[${i}]`
      if (element.id === undefined) element.id = randomUUID()
      if (element.type === undefined) element.type = element.specialStageType ? 'special-stage' : 'stage'
      if (!Array.isArray(element.neighbors)) element.neighbors = []
      if (element.type === 'stage' && !(Array.isArray(element.contentsList) && element.contentsList.length)) context.report(`${at}.contentsList`, 'is required for a stage: write at least 1 content')
      if (element.specialStageType === 'link' && !element.specialStageLinkURL) context.report(`${at}.specialStageLinkURL`, 'is required for a link stage')
      if (!element.neighbors.length && elements.length > 1) context.note(at, 'is joined to no other stage')
    })
    if (gamemap.paths === undefined) gamemap.paths = []
  }
}

/* ---------------------------------------------------------------- Find the Hotspot */

/**
 * The areas a learner can click, each a rectangle or a circle inside the picture, and one of them
 * at least the right one, or no click can score.
 * @type {Layout}
 */
const imageHotspotQuestion = {
  after(params, path, context) {
    const settings = params?.imageHotspotQuestion?.hotspotSettings
    const hotspots = settings?.hotspot
    const at = `${path}.imageHotspotQuestion.hotspotSettings.hotspot`
    if (!Array.isArray(hotspots) || !hotspots.length) {
      context.report(at, 'is required: write at least 1 area, one of them correct')
      return
    }
    hotspots.forEach((/** @type {any} */ hotspot, /** @type {number} */ i) => {
      const area = hotspot?.computedSettings ?? {}
      for (const key of ['x', 'y', 'width', 'height']) {
        if (typeof area[key] !== 'number' || area[key] < 0 || area[key] > 100) context.report(`${at}[${i}].computedSettings.${key}`, 'is required: a number from 0 to 100, percent of the picture')
      }
      if (area.figure !== 'rectangle' && area.figure !== 'circle') context.report(`${at}[${i}].computedSettings.figure`, 'is required: "rectangle" or "circle"')
    })
    if (!hotspots.some((/** @type {any} */ hotspot) => hotspot?.userSettings?.correct)) context.report(at, 'has no correct area: set "correct": true in one area\'s userSettings')
  }
}

/* ---------------------------------------------------------------- Video */

/** @type {Layout} */
const video = { optional: ['visuals.poster'] }

/** @type {Record<string, Layout>} */
export const LAYOUTS = {
  'H5P.QuestionSet': questionSet,
  'H5P.InteractiveBook': interactiveBook,
  'H5P.CoursePresentation': coursePresentation,
  'H5P.InteractiveVideo': interactiveVideo,
  'H5P.BranchingScenario': branchingScenario,
  'H5P.GameMap': gameMap,
  'H5P.ImageHotspotQuestion': imageHotspotQuestion,
  'H5P.Video': video
}

/**
 * Semantics with the fields a layout makes optional marked so, for a copy the generator reads.
 * @param {string} machineName
 * @param {any[]} semantics
 */
export function patchSemantics(machineName, semantics) {
  const layout = LAYOUTS[machineName]
  for (const path of layout?.optional ?? []) {
    const field = fieldAt(semantics, path.replace(/\[\]/g, '').split('.'))
    if (field) field.optional = true
  }
  return semantics
}

/**
 * Every place a library's parameters sit in content: the content's own, at `params`, and each
 * sub-content's, with the path to it.
 * @param {string} main the main library's machine name
 * @param {any} params
 * @returns {{ library: string, params: any, path: string, holder: any }[]}
 */
export function placesOf(main, params) {
  /** @type {{ library: string, params: any, path: string, holder: any }[]} */
  const found = [{ library: main, params, path: 'params', holder: null }]
  /** @param {any} value @param {string} at */
  const walk = (value, at) => {
    if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${at}[${i}]`))
    else if (isObject(value)) {
      if (typeof value.library === 'string' && isObject(value.params)) found.push({ library: machineName(value.library), params: value.params, path: `${at}.params`, holder: value })
      for (const [key, item] of Object.entries(value)) walk(item, `${at}.${key}`)
    }
  }
  walk(params, 'params')
  return found
}
