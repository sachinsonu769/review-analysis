package qa;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
class Constants {
 static final String ROOT = "/audit";
 @GetMapping(ROOT + "/real") String concatenated() { return "v1"; }
 @GetMapping("/audit/real") String literal() { return "v1"; }
 @GetMapping("\u002Faudit\u002Fother") String unicode() { return "v1"; }
}