export function parseRecentChangelogReleases(markdown, limit = 10) {
    const lines = markdown.split(/\r?\n/)
    const releases = []
    let currentRelease = null
    let currentSection = ''

    for (const line of lines) {
        const releaseMatch = line.match(/^## \[([^\]]+)\] - (.+)$/)
        if (releaseMatch) {
            if (currentRelease) {
                releases.push(currentRelease)
            }

            if (releaseMatch[1] === 'X.Y.Z') {
                currentRelease = null
                currentSection = ''
                continue
            }

            currentRelease = {
                version: releaseMatch[1],
                date: releaseMatch[2],
                sections: [],
            }
            currentSection = ''
            continue
        }

        if (!currentRelease) continue

        const sectionMatch = line.match(/^###\s+(.+)$/)
        if (sectionMatch) {
            currentSection = sectionMatch[1]
            currentRelease.sections.push({
                title: currentSection,
                bullets: [],
            })
            continue
        }

        const bulletMatch = line.match(/^-\s+(.+)$/)
        if (!bulletMatch) continue

        if (!currentSection) {
            currentSection = 'Notes'
            currentRelease.sections.push({
                title: currentSection,
                bullets: [],
            })
        }

        const targetSection = currentRelease.sections[currentRelease.sections.length - 1]
        targetSection.bullets.push(bulletMatch[1])
    }

    if (currentRelease) {
        releases.push(currentRelease)
    }

    return releases.slice(0, limit)
}
