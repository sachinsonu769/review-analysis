package qa;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
@RequestMapping("/audit")
class OtherResource {
 @GetMapping("/real") String real() { return "v1"; }
 @GetMapping("/fake") String fake() { return "v1"; }
 @PostMapping("/real") String post() { return "v1"; }
}