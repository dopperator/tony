package sh.dop.tonybcast;

import java.util.HashMap;
import java.util.Map;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

public class TonyBcast extends JavaPlugin {

    private static final TextColor ORANGE = TextColor.color(0xFF8800);

    @Override
    public void onEnable() {
        getLogger().info("TonyBcast enabled.");
    }

    @Override
    public boolean onCommand(CommandSender sender, Command cmd, String label, String[] args) {
        if ("tonyquery".equalsIgnoreCase(cmd.getName())) {
            return handleQuery(sender, args);
        }
        if (!(sender instanceof ConsoleCommandSender) && !sender.isOp()) {
            sender.sendMessage(Component.text("nice try, pal.", NamedTextColor.RED));
            return true;
        }
        if (args.length < 3) {
            sender.sendMessage(Component.text("usage: /tonybcast <color> <addressee> <message...>", NamedTextColor.RED));
            return true;
        }

        String colorArg = args[0];
        String addressee = sanitize(args[1]);
        StringBuilder sb = new StringBuilder();
        for (int i = 2; i < args.length; i++) {
            if (i > 2) sb.append(' ');
            sb.append(args[i]);
        }
        String message = sanitize(sb.toString());

        TextColor msgColor = parseColor(colorArg);
        if (msgColor == null) msgColor = NamedTextColor.LIGHT_PURPLE;

        Component component = Component.text("[", NamedTextColor.GRAY)
            .append(Component.text("Tony", ORANGE))
            .append(Component.text(" \u2192 ", NamedTextColor.GRAY))
            .append(Component.text(addressee, NamedTextColor.AQUA))
            .append(Component.text("] ", NamedTextColor.GRAY))
            .append(Component.text(message, msgColor));

        for (Player p : Bukkit.getOnlinePlayers()) {
            p.sendMessage(component);
        }
        // Also echo to console so it shows in the server log
        Bukkit.getConsoleSender().sendMessage(component);
        return true;
    }

    // /tonyquery nearby <player> [radius] — counts non-player entities within radius
    // of the named player and prints one line: `[TonyQuery] nearby <player>: 5 cow, 3 pig, ...`
    // The bot's log tail picks up the line and parses it. Single round-trip, ~5ms.
    private boolean handleQuery(CommandSender sender, String[] args) {
        if (!(sender instanceof ConsoleCommandSender) && !sender.isOp()) {
            sender.sendMessage(Component.text("nice try, pal.", NamedTextColor.RED));
            return true;
        }
        if (args.length < 2 || !"nearby".equalsIgnoreCase(args[0])) {
            sender.sendMessage(Component.text("usage: /tonyquery nearby <player> [radius]", NamedTextColor.RED));
            return true;
        }
        Player target = Bukkit.getPlayerExact(args[1]);
        if (target == null) {
            getLogger().info("[TonyQuery] nearby " + args[1] + ": ERROR player not online");
            return true;
        }
        double radius = 32.0;
        if (args.length >= 3) {
            try { radius = Math.max(1.0, Math.min(128.0, Double.parseDouble(args[2]))); }
            catch (NumberFormatException ignored) {}
        }
        Location loc = target.getLocation();
        Map<String, Integer> counts = new HashMap<>();
        for (Entity e : target.getWorld().getNearbyEntities(loc, radius, radius, radius)) {
            if (e instanceof Player) continue;
            String type = e.getType().getKey().getKey();
            counts.merge(type, 1, Integer::sum);
        }
        StringBuilder out = new StringBuilder("[TonyQuery] nearby ").append(target.getName()).append(": ");
        if (counts.isEmpty()) {
            out.append("none");
        } else {
            counts.entrySet().stream()
                .sorted((a, b) -> b.getValue() - a.getValue())
                .forEach(en -> out.append(en.getValue()).append(" ").append(en.getKey()).append(", "));
            out.setLength(out.length() - 2);
        }
        getLogger().info(out.toString());
        return true;
    }

    // Strip section sign and ASCII control characters to avoid Paper's chat encoder crash
    private static String sanitize(String s) {
        if (s == null) return "";
        StringBuilder out = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\u00A7') continue;
            if (c < 0x20) continue;
            if (c == 0x7F) continue;
            out.append(c);
        }
        return out.toString();
    }

    private static TextColor parseColor(String name) {
        if (name == null) return null;
        String n = name.toLowerCase();
        switch (n) {
            case "light_purple": return NamedTextColor.LIGHT_PURPLE;
            case "red":          return NamedTextColor.RED;
            case "yellow":       return NamedTextColor.YELLOW;
            case "gray":         return NamedTextColor.GRAY;
            case "white":        return NamedTextColor.WHITE;
            case "aqua":         return NamedTextColor.AQUA;
            case "gold":         return NamedTextColor.GOLD;
            case "green":        return NamedTextColor.GREEN;
            default: break;
        }
        if (n.startsWith("#") && n.length() == 7) {
            try {
                int rgb = Integer.parseInt(n.substring(1), 16);
                return TextColor.color(rgb);
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }
}
