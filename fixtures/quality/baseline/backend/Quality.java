package fixture;
public class Quality {
  public String safe(String input) {
    if (input != null && !input.isEmpty()) return input;
    return "";
  }
}
