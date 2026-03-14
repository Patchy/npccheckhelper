# NPC Check Helper

This module is mostly meant for my friend and homebrew campaigns where non combat homebrew npcs might not have apporiate levels, which significantly affects the outcome of skill checks against npcs. The goal is to roughly give the feeling of proficiency without level for skill checks when desired with a toggle.
Adds a checkbox for NPC sheets, that when toggled, keeps the actor's printed level alone but shifts the level based proficiency bonus of all values related to skill checks to the current party level:

- Perception modifier and Perception DC
- Saving throws and save DCs, including Will DC
- Skill modifiers and skill DCs

The target party level is calculated from the active PF2e party if one exists. If there is no active party, the module falls back to the average level of player-owned character actors. 

