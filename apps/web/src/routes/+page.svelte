<script lang="ts">
  import { trpc } from "$lib/trpc";

  let health = $state<{ status: string } | null>(null);
  let error = $state<string | null>(null);

  async function checkHealth() {
    try {
      health = await trpc.health.query();
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : "Unknown error";
      health = null;
    }
  }
</script>

<h1>Pudgy</h1>

<button onclick={checkHealth}>Check API Health</button>

{#if health}
  <p>API status: {health.status}</p>
{/if}

{#if error}
  <p>Error: {error}</p>
{/if}
