import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * Each skill's front matter as a YAML parser reads it: skills.sh, a chat that takes the skill as a
 * zip and an agent's skill loader parse it, and one that does not parse is a skill they do not list
 * (#242's description broke it with a colon). No YAML parser is in the workspace, so each line is
 * held to the form the skills write, `key: value` with a plain value, which YAML ends at a colon
 * followed by a space and cuts at a space followed by `#`; and the name and description to the
 * Agent Skills specification's limits.
 */
const skills = resolve(import.meta.dirname, '../../../skills')
const names = (await readdir(skills, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)

describe("the skills' front matter", () => {
  it.each(names)('%s parses, its name its folder and its description under 1024 characters', async (name) => {
    const text = await readFile(resolve(skills, name, 'SKILL.md'), 'utf8')
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1]
    expect(front, 'front matter between two --- lines').toBeDefined()
    const fields = new Map<string, string>()
    for (const line of front!.split('\n')) {
      const [, key, value] = /^([a-z-]+): (.+)$/.exec(line) ?? []
      expect(key, `"${line.slice(0, 40)}" is a key and a value`).toBeDefined()
      expect(value, `${key}: a colon followed by a space or the line's end ends a plain value`).not.toMatch(/:(?: |$)/)
      expect(value, `${key}: a space followed by # starts a comment`).not.toMatch(/ #/)
      expect(value, `${key}: a plain value cannot start with an indicator`).not.toMatch(/^[-?:,[\]{}#&*!|>'"%@`]/)
      fields.set(key, value)
    }
    expect(fields.get('name')).toBe(name)
    expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(name.length).toBeLessThanOrEqual(64)
    expect(fields.get('description')?.length).toBeGreaterThan(0)
    expect(fields.get('description')!.length).toBeLessThanOrEqual(1024)
  })
})
