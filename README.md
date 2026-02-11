# InnitWeb

## Overview
InnitWeb is a static, client-side web tool for exploring a Minecraft player network. It visualizes players as nodes and their relationships as weighted edges, letting you quickly discover clusters, strong ties, and one-way vs two-way connections.

## What The Website Shows
- **Players (nodes):** Each node represents a player (UUID + username) and displays a Minecraft avatar.
- **Connections (edges):** Each edge represents a relationship between two players based on **total mentions** in the dataset.
- **Mutual vs non-mutual links:**
  - **Mutual** = both players mention each other (two-way). These edges are color-graded by strength.
  - **Non-mutual** = one-way mentions only. These edges are shown in gray (and can be hidden).
- **A live status bar:** Shows the number of currently visible players and connections.

## What This Tool Offers
### Interactive Graph Exploration
- Pan/zoom around the network.
- Click a node to select a player and focus the camera.
- Filter what is shown using built-in controls (mutual-only view, minimum weight threshold, hop distance).

### Connection Lists
When a player is selected, the left panel can show:
- **Mutual connections** (two-way relationships)
- **Non-mutual connections** (one-way relationships)

Connections are ordered by mentions and are clickable for fast navigation.

### Player Profile View
The left panel can also switch into a profile viewer that shows:
- Username and UUID
- Total joins
- Last seen (approx. “hours ago”)
- Playtime (hours)
- Kills, deaths, K/D
- Total messages
- Top connections (by mentions)
- “Lookalikes”

## Credits
- Graph rendering: `vis-network` (loaded from `https://unpkg.com/`).
