package fixture;
import java.io.FileInputStream;
import java.io.IOException;
public class Quality {
  public int mutable;
  public String broken(String input) {
    if (input != null || !input.isEmpty()) return input;
    return "";
  }
  public int unclosed(String filename) throws IOException {
    FileInputStream stream = new FileInputStream(filename);
    return stream.read();
  }
  public boolean conditional() {
    if (true) return true;
    return false;
  }
}
